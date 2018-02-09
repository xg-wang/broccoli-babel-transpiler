'use strict';

var fs = require('fs');
var os = require('os');
var expect = require('chai').expect;
var broccoli = require('broccoli');
var path = require('path');
var ps = require('ps-node');
var Babel = require('./index');
var helpers = require('broccoli-test-helpers');
var stringify = require('json-stable-stringify');
var mkdirp = require('mkdirp').sync;
var rm = require('rimraf').sync;
var makeTestHelper = helpers.makeTestHelper;
var cleanupBuilders = helpers.cleanupBuilders;
var RSVP = require('rsvp');
var Promise = RSVP.Promise;
var moduleResolve = require('amd-name-resolver').moduleResolve;
var ParallelApi = require('./lib/parallel-api');

var inputPath = path.join(__dirname, 'fixtures');
var expectations = path.join(__dirname, 'expectations');

var moduleResolveParallel = function() {};
moduleResolveParallel._parallelBabel = {
  requireFile: fixtureFullPath('amd-name-resolver-parallel'),
  useMethod: 'moduleResolve',
};
var getModuleIdParallel = function() {};
getModuleIdParallel._parallelBabel = {
  requireFile: fixtureFullPath('get-module-id-parallel'),
  buildUsing: 'build',
  params: { name: 'testModule' },
};
var shouldPrintCommentParallel = function() {};
shouldPrintCommentParallel._parallelBabel = {
  requireFile: fixtureFullPath('print-comment-parallel'),
  buildUsing: 'buildMe',
  params: { contents: 'comment 1' },
};

var babel;

function fixtureFullPath(filename) {
  return path.join(__dirname, 'fixtures', filename);
}

function terminateWorkerPool() {
  // shut down any workerpool that is running at this point
  var babelCoreVersion = ParallelApi.getBabelVersion();
  var workerPoolId = 'v1/broccoli-babel-transpiler/workerpool/babel-core-' + babelCoreVersion;
  var runningPool = process[workerPoolId];
  if (runningPool) {
    return runningPool.terminate()
    .then(function() {
      delete process[workerPoolId];
    });
  }
}

describe('options', function() {
  var options;

  before(function() {
    options = {
      foo: 1,
      bar: {
        baz: 1
      },
      filterExtensions: ['es6']
    };

    babel = new Babel('foo', options);
  });

  it('are cloned', function() {
    var transpilerOptions;

    babel.transform = function(string, options) {
      transpilerOptions = options;
      return Promise.resolve({ code: {} });
    };

    expect(transpilerOptions).to.eql(undefined);
    babel.processString('path', 'relativePath');

    expect(transpilerOptions.foo).to.eql(1);
    expect(transpilerOptions.bar.baz).to.eql(1);

    options.foo = 2;
    options.bar.baz = 2;

    expect(transpilerOptions.foo).to.eql(1);
    expect(transpilerOptions.bar.baz).to.eql(1);
  });

  it('correct fileName, sourceMapName, sourceFileName', function() {
    var transpilerOptions;

    babel.transform = function(string, options) {
      transpilerOptions = options;
      return Promise.resolve({ code: {} });
    };

    expect(transpilerOptions).to.eql(undefined);
    babel.processString('path', 'relativePath');

    expect(transpilerOptions.moduleId).to.eql(undefined);
    expect(transpilerOptions.filename).to.eql('relativePath');
    expect(transpilerOptions.sourceMapName).to.eql('relativePath');
    expect(transpilerOptions.sourceFileName).to.eql('relativePath');
  });

  it('includes moduleId if options.moduleId is true', function() {
    babel.options.moduleId = true;
    babel.options.filename = 'relativePath.es6';

    var transpilerOptions;

    babel.transform = function(string, options) {
      transpilerOptions = options;
      return Promise.resolve({ code: {} });
    };

    expect(transpilerOptions).to.eql(undefined);
    babel.processString('path', 'relativePath');

    expect(transpilerOptions.moduleId).to.eql('relativePath');
  });

  it('does not propagate validExtensions', function () {
    var transpilerOptions;

    babel.transform = function(string, options) {
      transpilerOptions = options;
      return Promise.resolve({ code: {} });
    };

    expect(transpilerOptions).to.eql(undefined);
    babel.processString('path', 'relativePath');

    expect(transpilerOptions.filterExtensions).to.eql(undefined);
  });
});

describe('transpile ES6 to ES5', function() {
  this.timeout(10*1000); // some of these are slow in CI

  before(function() {
    babel = makeTestHelper({
      subject: function() {
        return new Babel(arguments[0], arguments[1]);
      },
      fixturePath: inputPath
    });
  });

  afterEach(function () {
    return cleanupBuilders()
      .then(function() {
        return terminateWorkerPool();
      });
  });

  it('basic', function () {
    return babel('files', {
      inputSourceMap:false,
      sourceMap: false
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'expected.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('using parallel API', function () {
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      plugins: [
        {
          _parallelBabel: {
            requireFile: fixtureFullPath('plugin-example-parallel'),
          }
        }
      ]
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures-functions.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'functions.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('using parallel API (in main process)', function () {
    var pluginFunction = require('babel-plugin-unassert');
    pluginFunction.baseDir = function() {
      return path.join(__dirname, 'node_modules', 'babel-plugin-unassert');
    };
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      plugins: [
        {
          _parallelBabel: {
            requireFile: fixtureFullPath('plugin-example-parallel'),
          }
        },
        pluginFunction,
      ]
    }).then(function(results) {
      var outputPath = results.directory;

      var output1 = fs.readFileSync(path.join(outputPath, 'fixtures-functions.js'), 'utf8');
      var input1 = fs.readFileSync(path.join(expectations, 'functions.js'), 'utf8');
      expect(output1).to.eql(input1);

      var output2 = fs.readFileSync(path.join(outputPath, 'fixtures-assert.js'), 'utf8');
      var input2 = fs.readFileSync(path.join(expectations, 'assert.js'), 'utf8');
      expect(output2).to.eql(input2);
    });
  });

  it('basic (in main process)', function () {
    var pluginFunction = require('babel-plugin-unassert');
    pluginFunction.baseDir = function() {
      return path.join(__dirname, 'node_modules', 'babel-plugin-unassert');
    };
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      // cannot parallelize if any of the plugins are functions
      plugins: [
        pluginFunction,
        'babel-plugin-example',
      ]
    }).then(function(results) {
      var outputPath = results.directory;

      var output1 = fs.readFileSync(path.join(outputPath, 'fixtures-functions.js'), 'utf8');
      var input1 = fs.readFileSync(path.join(expectations, 'functions.js'), 'utf8');
      expect(output1).to.eql(input1);

      var output2 = fs.readFileSync(path.join(outputPath, 'fixtures-assert.js'), 'utf8');
      var input2 = fs.readFileSync(path.join(expectations, 'assert.js'), 'utf8');
      expect(output2).to.eql(input2);
    });
  });

  it('inline source maps', function () {
    return babel('files', {
      sourceMap: 'inline'
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'expected-inline-source-maps.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('modules (in main process)', function () {
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      resolveModuleSource: moduleResolve
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures-imports.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'imports.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('modules - parallel API', function () {
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      resolveModuleSource: moduleResolveParallel
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures-imports.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'imports.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('module IDs (in main process)', function () {
    return babel('files', {
      plugins: [],
      modules: 'amd',
      moduleIds: true,
      getModuleId: function(moduleName) { return 'testModule'; },
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures-imports.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'imports-getModuleId.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('module IDs - parallel API', function () {
    return babel('files', {
      plugins: [],
      modules: 'amd',
      moduleIds: true,
      getModuleId: getModuleIdParallel,
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures-imports.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'imports-getModuleId.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('shouldPrintComment (in main process)', function () {
    return babel('files', {
      shouldPrintComment: function(comment) { return comment === 'comment 1'; },
    }).then(function(results) {
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'fixtures-comments.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'comments.js'), 'utf8');
      expect(output).to.eql(input);
    });
  });

  it('shouldPrintComment - parallel API', function () {
    return babel('files', {
      shouldPrintComment: shouldPrintCommentParallel,
    }).then(function(results) {
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'fixtures-comments.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'comments.js'), 'utf8');
      expect(output).to.eql(input);
    });
  });
});

describe('filters files to transform', function() {
  this.timeout(10*1000); // some of these are slow in CI

  before(function() {
    babel = makeTestHelper({
      subject: function() {
        return new Babel(arguments[0], arguments[1]);
      },
      fixturePath: inputPath
    });
  });

  afterEach(function () {
    return cleanupBuilders();
  });

  it('default', function () {
    return babel('files', {
      inputSourceMap:false,
      sourceMap: false
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'expected.js'), 'utf8');

      expect(output).to.eql(input);
      // Verify that .es6 file was not transformed
      expect(fs.existsSync(path.join(outputPath, 'fixtures-es6.es6'))).to.be.ok;
    });
  });

  it('uses specified filter', function () {
    return babel('files', {
      filterExtensions: ['es6'],
      inputSourceMap: false,
      sourceMap: false
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'fixtures-es6.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'expected.js'), 'utf8');

      expect(output).to.eql(input);
      // Verify that .es6 file was not transformed
      expect(fs.existsSync(path.join(outputPath, 'fixtures-es6.es6'))).to.not.be.ok;
    });
  });

  it('uses multiple specified filters', function() {
    return babel('files', {
      filterExtensions: ['js', 'es6'],
      inputSourceMap: false,
      sourceMap: false
    }).then(function(results) {
      var outputPath = results.directory;

      var es6ExtOutput = fs.readFileSync(path.join(outputPath, 'fixtures-es6.js'), 'utf8');
      var jsExtOutput = fs.readFileSync(path.join(outputPath, 'fixtures.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'expected.js'), 'utf8');

      expect(es6ExtOutput).to.eql(input);
      expect(jsExtOutput).to.eql(input);
      // Verify that .es6 file was not transformed
      expect(fs.existsSync(path.join(outputPath, 'fixtures-es6.es6'))).to.not.be.ok;
    });
  });

  it('named module', function() {
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      moduleId: "foo",
      modules: 'amdStrict'
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'named-module-fixture.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'named-module.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });


  it('moduleId === true', function() {
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      moduleId: true,
      modules: 'amdStrict'
    }).then(function(results) {
      var outputPath = results.directory;

      var output = fs.readFileSync(path.join(outputPath, 'true-module-fixture.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'true-module.js'), 'utf8');

      expect(output).to.eql(input);
    });
  });

  it('throws if a single helper is not whitelisted', function() {
    return babel('file', {
      helperWhiteList: ['class-call-check', 'get']
    }).catch(function(err) {
      expect(err.message).to.match(/^fixtures.js was transformed and relies on `[a-z-]+`, which was not included in the helper whitelist. Either add this helper to the whitelist or refactor to not be dependent on this runtime helper.$/);
    });
  });

  it('throws if multiple helpers are not whitelisted', function() {
    return babel('file', {
      helperWhiteList: [],
    }).catch(function(err) {
      expect(err.message).to.match(/^fixtures.js was transformed and relies on `[a-z-]+`, `[a-z-]+`, & `[a-z-]+`, which were not included in the helper whitelist. Either add these helpers to the whitelist or refactor to not be dependent on these runtime helpers.$/);
    });
  });

  it('does not throw if helpers are specified', function() {
    return babel('files', {
      helperWhiteList: ['class-call-check', 'get', 'inherits', 'interop-require-default'],
    }).then(function(results) {
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'fixtures-classes.js'), 'utf8');
      var input = fs.readFileSync(path.join(expectations, 'classes.js'), 'utf8');
      expect(output).to.eql(input);
    });
  });
});

describe.skip('module metadata', function() {
  before(function() {
    babel = makeTestHelper({
      subject: function() {
        return new Babel(arguments[0], arguments[1]);
      },
      fixturePath: inputPath
    });
  });

  afterEach(function () {
    return cleanupBuilders();
  });

  it('exports module metadata', function() {
    return babel('files', {
      exportModuleMetadata: true,
      moduleId: true,
      modules: 'amdStrict',
      sourceMap: false,
      inputSourceMap: false
    }).then(function(results) {
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'dep-graph.json'), 'utf8');
      var expectation = fs.readFileSync(path.join(expectations, 'dep-graph.json'), 'utf8');
      expect(output).to.eql(expectation);
    });
  });

  it('handles adding and removing files', function() {
    return babel('files', {
      exportModuleMetadata: true,
      moduleId: true,
      modules: 'amdStrict',
      sourceMap: false,
      inputSourceMap: false
    }).then(function(results) {
      // Normal build
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'dep-graph.json'), 'utf8');
      var expectation = fs.readFileSync(path.join(expectations, 'dep-graph.json'), 'utf8');
      expect(output).to.eql(expectation);

      // Move away files/fixtures.js
      fs.renameSync(path.join(inputPath, 'files', 'fixtures.js'), path.join(inputPath, 'fixtures.js'));
      return results.builder();
    }).then(function(results) {
      // Add back file/fixtures.js
      fs.renameSync(path.join(inputPath, 'fixtures.js'), path.join(inputPath, 'files', 'fixtures.js'));

      // Build without files/fixtures.js
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'dep-graph.json'), 'utf8');
      var expectation = fs.readFileSync(path.join(expectations, 'pruned-dep-graph.json'), 'utf8');
      expect(output).to.eql(expectation);

      return results.builder();
    }).then(function(results) {
      // Back to the first build
      var outputPath = results.directory;
      var output = fs.readFileSync(path.join(outputPath, 'dep-graph.json'), 'utf8');
      var expectation = fs.readFileSync(path.join(expectations, 'dep-graph.json'), 'utf8');
      expect(output).to.eql(expectation);
    });
  });

  describe('_generateDepGraph', function() {
    var tmp = path.join(process.cwd(), 'test-temp');
    beforeEach(function() {
      mkdirp(tmp);
      babel = new Babel('foo');
      babel.outputPath = tmp;
    });

    afterEach(function() {
      rm(tmp);
      babel.outputPath = null;
    });

    it('should generate a graph', function() {
      babel._cache.keys = function() {
        return ['foo.js', 'bar.js'];
      };

      babel.moduleMetadata = {
        foo: {},
        bar: {}
      };

      babel._generateDepGraph();

      expect(fs.readFileSync(path.join(babel.outputPath, 'dep-graph.json'), 'utf8')).to.eql(stringify({
        bar: {},
        foo: {}
      }, { space: 2 }));
    });

    it('should evict imports from the graph that are no longer in the tree', function() {
      babel._cache.keys = function() {
        return ['foo.js'];
      };

      babel.moduleMetadata = {
        foo: {}
      };

      babel._generateDepGraph();

      expect(fs.readFileSync(path.join(babel.outputPath, 'dep-graph.json'), 'utf8')).to.eql(stringify({
        foo: {}
      }, { space: 2 }));
    });
  });

});

describe('consume broccoli-babel-transpiler options', function() {
  it('enabled', function() {
    var options = {
      exportModuleMetadata: true,
      browserPolyfill: true
    };

    babel = new Babel('foo', options);
    var code = babel.processString('path', 'relativePath');
    expect(code).to.be.ok;
  });

  it('explicitly disabled', function() {
    var options = {
      exportModuleMetadata: false,
      browserPolyfill: false
    };

    babel = new Babel('foo', options);
    var code = babel.processString('path', 'relativePath');
    expect(code).to.be.ok;
  });
});

describe('when options change', function() {
  var originalHash, options, fakeConsole, consoleMessages;

  beforeEach(function() {
    fakeConsole = {
      warn: function(message) { consoleMessages.push(message); }
    };
    consoleMessages = [];

    options = {
      bar: 1,
      baz: function() {},
      console: fakeConsole,
      plugins: []
    };

    var babel = new Babel('foo', options);

    originalHash = babel.optionsHash();
  });

  it('clears cache for added properties', function() {
    options.foo = 1;
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });

  it('includes object plugins cacheKey result in hash', function() {
    options.plugins = [
      { cacheKey: function() { return 'hi!'; }}
    ];
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });

  it('includes function plugins cacheKey result in hash', function() {
    function fakePlugin() {}
    fakePlugin.cacheKey = function() { return 'Hi!'; };

    options.plugins = [
      fakePlugin
    ];
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });

  it('includes string plugins in hash calculation', function() {
    options.plugins = [
      'foo'
    ];
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });

  it('includes plugins specified with options in hash calculation when cacheable', function() {
    var pluginOptions = { foo: 'bar' };
    options.plugins = [
      ['foo', pluginOptions]
    ];
    options.console = fakeConsole;
    var first = new Babel('foo', options);
    var firstOptions = first.optionsHash();

    options.console = fakeConsole;
    var second = new Babel('foo', options);
    var secondOptions = second.optionsHash();
    expect(firstOptions).to.eql(secondOptions);

    pluginOptions.qux = 'huzzah';
    options.console = fakeConsole;
    var third = new Babel('foo', options);
    var thirdOptions = third.optionsHash();

    expect(firstOptions).to.not.eql(thirdOptions);
  });

  it('invalidates plugins specified with options when not-cacheable', function() {
    function thing() { }
    var pluginOptions = { foo: 'bar', thing: thing };
    options.plugins = [
      ['foo', pluginOptions]
    ];
    options.console = fakeConsole;
    var first = new Babel('foo', options);
    var firstOptions = first.optionsHash();

    options.console = fakeConsole;
    var second = new Babel('foo', options);
    var secondOptions = second.optionsHash();
    expect(firstOptions).to.not.eql(secondOptions);
  });

  it('plugins specified with options can have functions with `baseDir`', function() {
    var dir = path.join(inputPath, 'plugin-a');
    function thing() { }
    thing.baseDir = function() { return dir; };
    var pluginOptions = { foo: 'bar', thing: thing };
    options.plugins = [
      ['foo', pluginOptions]
    ];

    options.console = fakeConsole;
    var first = new Babel('foo', options);
    var firstOptions = first.optionsHash();

    options.console = fakeConsole;
    var second = new Babel('foo', options);
    var secondOptions = second.optionsHash();
    expect(firstOptions).to.eql(secondOptions);

    dir = path.join(inputPath, 'plugin-b');
    options.console = fakeConsole;
    var third = new Babel('foo', options);
    var thirdOptions = third.optionsHash();

    expect(firstOptions).to.not.eql(thirdOptions);
  });

  it('plugins can be objects with `baseDir`', function() {
    var dir = path.join(inputPath, 'plugin-a');
    var pluginObject = { foo: 'foo' };
    pluginObject.baseDir = function() { return dir; };
    options.plugins = [ pluginObject ];

    options.console = fakeConsole;
    var first = new Babel('foo', options);
    var firstOptions = first.optionsHash();

    options.console = fakeConsole;
    var second = new Babel('foo', options);
    var secondOptions = second.optionsHash();

    expect(firstOptions).to.eql(secondOptions);

    dir = path.join(inputPath, 'plugin-b');
    options.console = fakeConsole;
    var third = new Babel('foo', options);
    var thirdOptions = third.optionsHash();

    expect(firstOptions).to.not.eql(thirdOptions);
  });

  it('plugins can be objects with `cacheKey`', function() {
    var dir = path.join(inputPath, 'plugin-a');
    var key = 'cacheKey1';
    var pluginObject = { foo: 'foo' };
    pluginObject.baseDir = function() { return dir; };
    pluginObject.cacheKey = function() { return key; };
    options.plugins = [ pluginObject ];

    options.console = fakeConsole;
    var first = new Babel('foo', options);
    var firstOptions = first.optionsHash();

    options.console = fakeConsole;
    var second = new Babel('foo', options);
    var secondOptions = second.optionsHash();

    expect(firstOptions).to.eql(secondOptions);

    options.console = fakeConsole;
    key = 'cacheKey3';
    var third = new Babel('foo', options);
    var thirdOptions = third.optionsHash();

    expect(firstOptions).to.not.eql(thirdOptions);
  });


  it('a plugins `baseDir` method is used for hash generation', function() {
    var dir = path.join(inputPath, 'plugin-a');

    function plugin() {}
    plugin.baseDir = function() {
      return dir;
    };
    options.plugins = [ plugin ];

    options.console = fakeConsole;
    var first = new Babel('foo', options);
    var firstOptions = first.optionsHash();

    dir = path.join(inputPath, 'plugin-b');
    options.console = fakeConsole;
    var second = new Babel('foo', options);
    var secondOptions = second.optionsHash();

    expect(firstOptions).to.not.eql(secondOptions);
  });

  it('a plugin without a baseDir invalidates the cache every time', function() {
    function plugin() {}
    plugin.toString = function() { return '<derp plugin>'; };
    options.plugins = [ plugin ];

    options.console = fakeConsole;
    var babel1 = new Babel('foo', options);
    options.console = fakeConsole;
    var babel2 = new Babel('foo', options);

    expect(babel1.optionsHash()).to.not.eql(babel2.optionsHash());
    expect(consoleMessages).to.eql([
      'broccoli-babel-transpiler is opting out of caching due to a plugin that does not provide a caching strategy: `<derp plugin>`.',
      'broccoli-babel-transpiler is opting out of caching due to a plugin that does not provide a caching strategy: `<derp plugin>`.'
    ]);
  });

  it('clears cache for updated properties', function() {
    options.bar = 2;
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });

  it('clears cache for added methods', function() {
    options.foo = function() {};
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });

  it('clears cache for updated methods', function() {
    options.baz = function() { return 1; };
    options.console = fakeConsole;
    var babelNew = new Babel('foo', options);

    expect(babelNew.optionsHash()).to.not.eql(originalHash);
  });
});

describe('on error', function() {

  before(function() {
    babel = makeTestHelper({
      subject: function() {
        return new Babel(arguments[0], arguments[1]);
      },
      fixturePath: inputPath
    });
  });

  afterEach(function () {
    return cleanupBuilders()
      .then(function() {
        return terminateWorkerPool();
      });
  });

  it('returns error from the main process', function () {
    var pluginFunction = require('babel-plugin-unassert');
    pluginFunction.baseDir = function() {
      return path.join(__dirname, 'node_modules', 'babel-plugin-unassert');
    };
    return babel('errors', {
      inputSourceMap: false,
      sourceMap: false,
      plugins: [
        'example',
        pluginFunction,
      ]
    }).then(
      function onSuccess(results) {
        expect.fail('', '', 'babel should throw an error');
      },
      function onFailure(err) {
        expect(err.message).to.eql('fixtures.js: Unexpected token (1:9)');
      }
    );
  });

  it('returns error from a worker process', function () {
    return babel('errors', {
      inputSourceMap: false,
      sourceMap: false,
      plugins: [
        'example',
        'unassert',
      ]
    }).then(
      function onSuccess(results) {
        expect.fail('', '', 'babel should throw an error');
      },
      function onFailure(err) {
        expect(err.message).to.eql('fixtures.js: Unexpected token (1:9)');
      }
    );
  });

  it('fails if worker process is terminated', function () {
    this.timeout(10*1000);
    return babel('files', {
      inputSourceMap: false,
      sourceMap: false,
      plugins: [
        {
          _parallelBabel: {
            requireFile: fixtureFullPath('plugin-process-exit'),
            buildUsing: 'buildMeAFunction',
          }
        }
      ]
    }).then(
      function onSuccess(results) {
        expect.fail('', '', 'babel should throw an error');
      },
      function onFailure(err) {
        expect(err.message).to.eql('Worker terminated unexpectedly');
      }
    );
  });
});

describe('deserializeOptions()', function() {

  afterEach(function() {
    return terminateWorkerPool();
  });

  it('passes other options through', function () {
    var options = {
      inputSourceMap: false,
      sourceMap: false,
      somethingElse: 'foo',
    };
    expect(ParallelApi.deserializeOptions(options)).to.eql({
      inputSourceMap: false,
      sourceMap: false,
      somethingElse: 'foo',
    });
  });

  it('passes through plugins that do not use the parallel API', function () {
    var pluginFunction = function doSomething() {
      return 'something';
    };
    var options = {
      plugins: [
        pluginFunction,
        'transform-strict-mode',
        'transform-es2015-block-scoping',
        [ 'something' ],
        [ 'something', 'else' ],
        [ { objects: 'should' }, { be: 'passed'}, 'through'],
      ]
    };
    expect(ParallelApi.deserializeOptions(options)).to.eql({
      plugins: [
        pluginFunction,
        'transform-strict-mode',
        'transform-es2015-block-scoping',
        [ 'something' ],
        [ 'something', 'else' ],
        [ { objects: 'should' }, { be: 'passed'}, 'through'],
      ]
    });
  });

  it('builds plugins using the parallel API', function () {
    var options = {
      plugins: [
        {
          _parallelBabel: {
            requireFile: fixtureFullPath('plugin-example-parallel'),
          }
        },
        'transform-es2015-block-scoping'
      ]
    };
    expect(ParallelApi.deserializeOptions(options)).to.eql({
      plugins: [
        'babel-plugin-example',
        'transform-es2015-block-scoping'
      ]
    });
  });

  it('leaves callback functions alone', function () {
    var moduleNameFunc = function(moduleName) {};
    var commentFunc = function(comment) {};
    var options = {
      resolveModuleSource: moduleResolve,
      getModuleId: moduleNameFunc,
      shouldPrintComment: commentFunc,
    };
    expect(ParallelApi.deserializeOptions(options)).to.eql({
      resolveModuleSource: moduleResolve,
      getModuleId: moduleNameFunc,
      shouldPrintComment: commentFunc,
    });
  });

  it('builds resolveModuleSource using the parallel API', function () {
    var options = {
      resolveModuleSource: moduleResolveParallel
    };
    expect(ParallelApi.deserializeOptions(options).resolveModuleSource).to.be.a('function');
    expect(ParallelApi.deserializeOptions(options)).to.eql({
      resolveModuleSource: moduleResolve
    });
  });

  it('builds getModuleId using the parallel API', function () {
    var options = {
      getModuleId: getModuleIdParallel
    };
    expect(ParallelApi.deserializeOptions(options).getModuleId).to.be.a('function');
  });

  it('builds shouldPrintComment using the parallel API', function () {
    var options = {
      shouldPrintComment: shouldPrintCommentParallel
    };
    expect(ParallelApi.deserializeOptions(options).shouldPrintComment).to.be.a('function');
  });
});

describe('implementsParallelAPI()', function() {
  it('string - no', function () {
    expect(ParallelApi.implementsParallelAPI('transform-es2025')).to.eql(false);
  });

  it('function - no', function () {
    expect(ParallelApi.implementsParallelAPI(function() {})).to.eql(false);
  });

  it('[] - no', function () {
    expect(ParallelApi.implementsParallelAPI([])).to.eql(false);
  });

  it('["plugin-name", { options }] - no', function () {
    expect(ParallelApi.implementsParallelAPI(['plugin-name', {foo: 'bar'}])).to.eql(false);
  });

  it('[{ object }, { options }] - no', function () {
    expect(ParallelApi.implementsParallelAPI([{some: 'object'}, {foo: 'bar'}])).to.eql(false);
  });

  it('{ requireFile: "some/file" } - no', function () {
    expect(ParallelApi.implementsParallelAPI({ requireFile: 'some/file' })).to.eql(false);
  });

  it('{ _parallelBabel: { some: "stuff" } } - no', function () {
    expect(ParallelApi.implementsParallelAPI({ _parallelBabel: { some: 'stuff' } })).to.eql(false);
  });

  it('{ _parallelBabel: { requireFile: "a/file" } } - yes', function () {
    expect(ParallelApi.implementsParallelAPI({ _parallelBabel: { requireFile: 'a/file' } })).to.eql(true);
  });
});

describe('pluginCanBeParallelized()', function() {
  it('string - yes', function () {
    expect(ParallelApi.pluginCanBeParallelized('transform-es2025')).to.eql(true);
  });

  it('function - no', function () {
    expect(ParallelApi.pluginCanBeParallelized(function() {})).to.eql(false);
  });

  it('[] - no', function () {
    expect(ParallelApi.pluginCanBeParallelized([])).to.eql(false);
  });

  it('["plugin-name", { options }] - no', function () {
    expect(ParallelApi.pluginCanBeParallelized(['plugin-name', {foo: 'bar'}])).to.eql(false);
  });

  it('{ _parallelBabel: { requireFile: "a/file" } } - yes', function () {
    expect(ParallelApi.pluginCanBeParallelized({ _parallelBabel: { requireFile: 'a/file' } })).to.eql(true);
  });
});

describe('pluginsAreParallelizable()', function() {
  it('undefined - yes', function () {
    expect(ParallelApi.pluginsAreParallelizable(undefined)).to.eql(true);
  });

  it('[] - yes', function () {
    expect(ParallelApi.pluginsAreParallelizable([])).to.eql(true);
  });

  it('array of plugins that are parllelizable - yes', function () {
    var plugins = [
      'some-plugin',
      'some-other-plugin',
      { _parallelBabel: { requireFile: "a/file" } },
    ];
    expect(ParallelApi.pluginsAreParallelizable(plugins)).to.eql(true);
  });

  it('one plugin is not parallelizable - no', function () {
    var plugins = [
      'some-plugin',
      'some-other-plugin',
      { requireFile: "another/file", options: {} },
      function() {},
    ];
    expect(ParallelApi.pluginsAreParallelizable(plugins)).to.eql(false);
  });
});

describe('callbacksAreParallelizable()', function() {
  it('no callback functions - yes', function () {
    var options = {
      inputSourceMap: false,
      plugins: [
        'some-plugin',
      ],
    };
    expect(ParallelApi.callbacksAreParallelizable(options)).to.eql(true);
  });

  it('function - no', function () {
    var options = {
      inputSourceMap: false,
      plugins: [
        'some-plugin'
      ],
      resolveModuleSource: function() {},
    };
    expect(ParallelApi.callbacksAreParallelizable(options)).to.eql(false);
  });

  it('function with correct _parallelBabel property - yes', function () {
    var someFunc = function() {};
    someFunc._parallelBabel = { requireFile: 'a/file' };
    var options = {
      inputSourceMap: false,
      plugins: [
        'some-plugin'
      ],
      keyDontMatter: someFunc,
    };
    expect(ParallelApi.callbacksAreParallelizable(options)).to.eql(true);
  });

  it('_parallelBabel set incorrectly - no', function () {
    var someFunc = function() {};
    someFunc._parallelBabel = { no: 'wrong' };
    var options = {
      inputSourceMap: false,
      plugins: [
        'some-plugin'
      ],
      keyDontMatter: someFunc,
    };
    expect(ParallelApi.callbacksAreParallelizable(options)).to.eql(false);
  });
});

describe('transformIsParallelizable()', function() {
  it('no plugins or resolveModule - yes', function () {
    var options = {};
    expect(ParallelApi.transformIsParallelizable(options)).to.eql(true);
  });

  it('plugins are parallelizable - yes', function () {
    var options = {
      plugins: [ 'some-plugin' ],
    };
    expect(ParallelApi.transformIsParallelizable(options)).to.eql(true);
  });

  it('resolveModule is parallelizable - yes', function () {
    var options = {
      resolveModuleSource: moduleResolveParallel
    };
    expect(ParallelApi.transformIsParallelizable(options)).to.eql(true);
  });

  it('both are parallelizable - yes', function () {
    var options = {
      plugins: [ 'some-plugin' ],
      resolveModuleSource: moduleResolveParallel
    };
    expect(ParallelApi.transformIsParallelizable(options)).to.eql(true);
  });

  it('plugins not parallelizable - no', function () {
    var options = {
      plugins: [ function() {} ],
      resolveModuleSource: moduleResolveParallel
    };
    expect(ParallelApi.transformIsParallelizable(options)).to.eql(false);
  });

  it('resolveModuleSource not parallelizable - no', function () {
    var options = {
      plugins: [ 'some-plugin' ],
      resolveModuleSource: function() {},
    };
    expect(ParallelApi.transformIsParallelizable(options)).to.eql(false);
  });
});

describe('serializeOptions()', function() {
  it('empty options', function() {
    expect(ParallelApi.serializeOptions({})).to.eql({});
  });

  it('passes through non-function options', function() {
    var options = {
      inputSourceMap: false,
      plugins: [ 'some-plugin' ],
    };
    expect(ParallelApi.serializeOptions(options)).to.eql(options);
  });

  it('transforms all functions', function() {
    var options = {
      moduleResolve: moduleResolveParallel,
      getModuleId: getModuleIdParallel,
      shouldPrintComment: shouldPrintCommentParallel,
    };
    var expected = {
      moduleResolve: { _parallelBabel: moduleResolveParallel._parallelBabel },
      getModuleId: { _parallelBabel: getModuleIdParallel._parallelBabel },
      shouldPrintComment: { _parallelBabel: shouldPrintCommentParallel._parallelBabel },
    };
    expect(ParallelApi.serializeOptions(options)).to.eql(expected);
  });
});

describe('buildFromParallelApiInfo()', function() {
  it('requireFile only', function() {
    var filePath = fixtureFullPath('plugin-example-parallel');
    var builtPlugin = ParallelApi.buildFromParallelApiInfo({ requireFile: filePath });
    expect(builtPlugin).to.eql(require(filePath));
  });

  it('throws error if requireFile path does not exist', function() {
    var filePath = 'some/file/that/does/not/exist';
    try {
      ParallelApi.buildFromParallelApiInfo({ requireFile: filePath });
      expect.fail('', '', 'should have thrown an error');
    }
    catch (err) {
      expect(err.message).to.eql("Cannot find module 'some/file/that/does/not/exist'");
    }
  });

  it('useMethod', function() {
    var filePath = fixtureFullPath('plugin-process-exit');
    var builtPlugin = ParallelApi.buildFromParallelApiInfo({ requireFile: filePath, useMethod: 'exampleFunction' });
    expect(builtPlugin).to.eql(require('babel-plugin-example'));
  });

  it('throws error if useMethod does not exist', function() {
    var filePath = fixtureFullPath('plugin-process-exit');
    try {
      ParallelApi.buildFromParallelApiInfo({ requireFile: filePath, useMethod: 'doesNotExist' });
      expect.fail('', '', 'should have thrown an error');
    }
    catch (err) {
      expect(err.message).to.eql("method 'doesNotExist' does not exist in file " + filePath);
    }
  });

  it('buildUsing, no params', function() {
    var filePath = fixtureFullPath('plugin-process-exit');
    var builtPlugin = ParallelApi.buildFromParallelApiInfo({ requireFile: filePath, buildUsing: 'build' });
    expect(builtPlugin).to.eql(require(filePath).build());
  });

  it('buildUsing, with params', function() {
    var filePath = fixtureFullPath('plugin-process-exit');
    var builtPlugin = ParallelApi.buildFromParallelApiInfo({ requireFile: filePath, buildUsing: 'buildTwo', params: { text: 'OK' } });
    expect(builtPlugin).to.eql('for-testingOK');
  });

  it('throws error if buildUsing method does not exist', function() {
    var filePath = fixtureFullPath('plugin-process-exit');
    try {
      ParallelApi.buildFromParallelApiInfo({ requireFile: filePath, buildUsing: 'doesNotExist' });
      expect.fail('', '', 'should have thrown an error');
    }
    catch (err) {
      expect(err.message).to.eql("'doesNotExist' is not a function in file " + filePath);
    }
  });

  it('useMethod and buildUsing', function() {
    var filePath = fixtureFullPath('plugin-process-exit');
    var builtPlugin = ParallelApi.buildFromParallelApiInfo({ requireFile: filePath, useMethod: 'exampleFunction', buildUsing: 'buildTwo', params: { text: 'OK' } });
    expect(builtPlugin).to.eql(require('babel-plugin-example'));
  });
});

describe('concurrency', function() {
  var parallelApiPath = require.resolve('./lib/parallel-api');

  afterEach(function() {
    delete require.cache[parallelApiPath];
    delete process.env.JOBS;
    ParallelApi = require('./lib/parallel-api');
    return terminateWorkerPool();
  });

  it('sets jobs automatically using detected cpus', function() {
    expect(ParallelApi.jobs).to.equal(os.cpus().length);
  });

  it('sets jobs using environment variable', function() {
    delete require.cache[parallelApiPath];
    process.env.JOBS = '17';
    ParallelApi = require('./lib/parallel-api');
    expect(ParallelApi.jobs).to.equal(17);
  });
});


describe('getBabelVersion()', function() {
  it ('returns the correct version', function() {
    var expectedVersion = require(path.join(__dirname, 'node_modules/babel-core/package.json')).version;
    expect(ParallelApi.getBabelVersion()).to.equal(expectedVersion);
  });
});

describe('workerpool', function() {
  var parallelApiPath = require.resolve('./lib/parallel-api');

  var stringToTransform = "const x = 0;";

  var options = {
    inputSourceMap: false,
    sourceMap: false,
  };

  afterEach(function() {
    delete process.env.JOBS;
    return terminateWorkerPool();
  });

  it('should limit to one pool per babel version', function() {
    this.timeout(10*1000);
    delete require.cache[parallelApiPath];
    process.env.JOBS = '2';
    var ParallelApiOne = require('./lib/parallel-api');
    delete require.cache[parallelApiPath];
    var ParallelApiTwo = require('./lib/parallel-api');

    var lookup = RSVP.denodeify(ps.lookup);

    return Promise.all([
      ParallelApiOne.transformString(stringToTransform, options),
      ParallelApiOne.transformString(stringToTransform, options),
      ParallelApiTwo.transformString(stringToTransform, options),
      ParallelApiTwo.transformString(stringToTransform, options),
    ]).then(function() {
      // for ps-node,
      // unix paths look like 'broccoli-babel-transpiler/lib/worker.js'
      // windows paths look like 'broccoli-babel-transpiler\\lib\\worker.js' (2 path separators)
      var processMatch = (os.platform() === 'win32')
        ? 'broccoli-babel-transpiler\\\\lib\\\\worker.js'
        : path.join('broccoli-babel-transpiler', 'lib', 'worker.js');
      return lookup({
        command: 'node',
        arguments: processMatch,
      });
    }).then(function(resultList) {
      expect(resultList.length).to.eql(2);
    });
  });

});

var Promise = require('bluebird');
var expect = require('expect.js');
var sinon = require('sinon');

var fakeServer = {
  log: function (tags, data) {},
  config: function () {
    return {
      get: function (key) {
        if (key === 'elasticsearch.url') {
          return 'http://localhost:12345';
        } else if (key === 'kibana.index') {
          return '.kibi';
        } else {
          return '';
        }
      }
    };
  },
  plugins: {
    elasticsearch: {
      client: {
        search: function () {
          return Promise.reject(new Error('Document does not exists'));
        }
      }
    }
  }
};



describe('JdbcQuery', function () {

  describe('fetchResults test if correct arguments are passed to generateCacheKey', function () {
    it('simple query', function (done) {

      var cacheMock = {
        get: function (key) { return '';},
        set: function (key, value, time) {}
      };

      var JdbcQuery = require('../../queries/jdbc_query');
      var jdbcQuery = new JdbcQuery(fakeServer, {
        activationQuery: '',
        resultQuery: 'select * from x',
        datasource: {
          datasourceClazz: {
            datasource: {
              datasourceParams: {
                connectionString: 'connectionString',
                cache_enabled: true
              }
            },
            populateParameters: function () {
              return '';
            }
          }
        }
      }, cacheMock);

      // stub _init to skip initialization
      sinon.stub(jdbcQuery, '_init', function () {
        return Promise.resolve(true);
      });
      // stub _execute queryto skip query execution
      sinon.stub(jdbcQuery, '_executeQuery', function () {
        return Promise.resolve({result: []});
      });

      var spy = sinon.spy(jdbcQuery, 'generateCacheKey');

      jdbcQuery.fetchResults({credentials: {username: 'fred'}}, false, 'variableName').then(function (res) {
        expect(res.results).to.eql({bindings: [{}]});
        expect(spy.callCount).to.equal(1);

        expect(spy.calledWithExactly('connectionString', 'select * from x', false, 'variableName', 'fred')).to.be.ok();

        jdbcQuery._init.restore();
        jdbcQuery._executeQuery.restore();
        jdbcQuery.generateCacheKey.restore();
        done();
      }).catch(done);

    });
  });

});

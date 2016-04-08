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



describe('MysqlQuery', function () {

  describe('fetchResults test if correct arguments are passed to generateCacheKey', function () {
    it('simple query', function (done) {

      var cacheMock = {
        get: function (key) { return '';},
        set: function (key, value, time) {}
      };

      var MysqlQuery = require('../../queries/mysql_query');
      var mysqlQuery = new MysqlQuery(fakeServer, {
        activationQuery: '',
        resultQuery: 'select * from x',
        datasource: {
          datasourceClazz: {
            getConnectionString: function () { return 'connectionString';},
            datasource: {
              datasourceParams: {
                cache_enabled: true,
                host: 'localhost',
                dbname: 'mydb'
              }
            },
            populateParameters: function () {
              return '';
            }
          }
        }
      }, cacheMock);

      // stub _init to skip initialization
      // stub _execute queryto skip query execution
      sinon.stub(mysqlQuery, '_executeQuery', function () {
        return Promise.resolve({result: {}});
      });

      var spy = sinon.spy(mysqlQuery, 'generateCacheKey');

      mysqlQuery.fetchResults({credentials: {username: 'fred'}}, false, 'variableX').then(function (res) {
        expect(res.results).to.eql({ bindings: []});
        expect(spy.callCount).to.equal(1);

        expect(spy.calledWithExactly('localhostmydb', 'select * from x', false, 'variableX', 'fred')).to.be.ok();

        mysqlQuery._executeQuery.restore();
        mysqlQuery.generateCacheKey.restore();
        done();
      }).catch(done);

    });
  });

});

import { compact, get, has, set, trim, trimRight } from 'lodash';
import { unset } from '../../utils';
import { methodNotAllowed } from 'boom';

import healthCheck from './lib/health_check';
import { createDataCluster } from './lib/create_data_cluster';
import { createAdminCluster } from './lib/create_admin_cluster';
import { clientLogger } from './lib/client_logger';
import { createClusters } from './lib/create_clusters';
import filterHeaders from './lib/filter_headers';

import createKibanaProxy, { createPath } from './lib/create_kibana_proxy';
import createKibiProxy from './lib/create_kibi_proxy';

// kibi: kibi imports
import transformations from './lib/transforms';
import util from './lib/util';
import dbfilter from './lib/dbfilter';
import inject from './lib/inject';
import sirenJoin from './lib/siren_join';
// kibi: end

const DEFAULT_REQUEST_HEADERS = [ 'authorization' ];

module.exports = function (kibana) {
  return new kibana.Plugin({
    require: ['kibana'],
    config(Joi) {
      const { array, boolean, number, object, string, ref } = Joi;

      const sslSchema = object({
        verificationMode: string().valid('none', 'certificate', 'full').default('full'),
        certificateAuthorities: array().single().items(string()),
        certificate: string(),
        key: string(),
        keyPassphrase: string()
      }).default();

      return object({
        enabled: boolean().default(true),
        url: string().uri({ scheme: ['http', 'https'] }).default('http://localhost:9200'),
        preserveHost: boolean().default(true),
        username: string(),
        password: string(),
        shardTimeout: number().default(0),
        requestTimeout: number().default(300000),
        requestHeadersWhitelist: array().items().single().default(DEFAULT_REQUEST_HEADERS),
        customHeaders: object().default({}),
        pingTimeout: number().default(ref('requestTimeout')),
        startupTimeout: number().default(5000),
        logQueries: boolean().default(false),
        ssl: sslSchema,
        apiVersion: Joi.string().default('5.x'),
        healthCheck: object({
          delay: number().default(2500)
        }).default(),
        tribe: object({
          url: string().uri({ scheme: ['http', 'https'] }),
          preserveHost: boolean().default(true),
          username: string(),
          password: string(),
          shardTimeout: number().default(0),
          requestTimeout: number().default(30000),
          requestHeadersWhitelist: array().items().single().default(DEFAULT_REQUEST_HEADERS),
          customHeaders: object().default({}),
          pingTimeout: number().default(ref('requestTimeout')),
          startupTimeout: number().default(5000),
          logQueries: boolean().default(false),
          ssl: sslSchema,
          apiVersion: Joi.string().default('5.x'),
        }).default()
      }).default();
    },

    deprecations({ rename }) {
      const sslVerify = (basePath) => {
        const getKey = (path) => {
          return compact([basePath, path]).join('.');
        };

        return (settings, log) => {
          const sslSettings = get(settings, getKey('ssl'));

          if (!has(sslSettings, 'verify')) {
            return;
          }

          const verificationMode = get(sslSettings, 'verify') ? 'full' : 'none';
          set(sslSettings, 'verificationMode', verificationMode);
          unset(sslSettings, 'verify');

          log(`Config key "${getKey('ssl.verify')}" is deprecated. It has been replaced with "${getKey('ssl.verificationMode')}"`);
        };
      };

      return [
        rename('ssl.ca', 'ssl.certificateAuthorities'),
        rename('ssl.cert', 'ssl.certificate'),
        sslVerify(),
        rename('tribe.ssl.ca', 'tribe.ssl.certificateAuthorities'),
        rename('tribe.ssl.cert', 'tribe.ssl.certificate'),
        sslVerify('tribe')
      ];
    },

    uiExports: {
      injectDefaultVars(server, options) {
        return {
          esRequestTimeout: options.requestTimeout,
          esShardTimeout: options.shardTimeout,
          esApiVersion: options.apiVersion,
          esDataIsTribe: get(options, 'tribe.url') ? true : false,
        };
      }
    },

    init(server) {
      const kibanaIndex = server.config().get('kibana.index');
      const clusters = createClusters(server);

      server.expose('getCluster', clusters.get);
      server.expose('createCluster', clusters.create);

      server.expose('filterHeaders', filterHeaders);
      server.expose('ElasticsearchClientLogging', clientLogger(server));

      createDataCluster(server);
      createAdminCluster(server);

      // kibi: expose Kibi utility methods
      const transforms = transformations(server);
      server.expose('transformSearchRequest', transforms.transformSearchRequest);
      server.expose('transformSearchResponse', transforms.transformSearchResponse);
      server.expose('getQueriesAsPromise', util.getQueriesAsPromise);
      server.expose('dbfilter', dbfilter);
      server.expose('inject', inject);
      server.expose('sirenJoinSequence', sirenJoin(server).sequence);
      server.expose('sirenJoinSet', sirenJoin(server).set);
      // kibi: end

      createKibiProxy(server, 'GET', '/{paths*}');
      createKibiProxy(server, 'POST', '/_mget');
      createKibiProxy(server, 'PUT', '/_siren/license'); // kibi: Insert new license
      createKibiProxy(server, 'DELETE', '/_siren/license'); // kibi: Delete existing license
      createKibiProxy(server, 'POST', '/{index}/_search');
      createKibiProxy(server, 'POST', '/{index}/{type}/_search'); // siren: for some searches we specify the index type
      createKibiProxy(server, 'POST', '/{index}/_field_stats');
      createKibiProxy(server, 'POST', '/_msearch');
      createKibanaProxy(server, 'POST', '/_search/scroll');

      function noBulkCheck({ path }, reply) {
        if (/\/_bulk/.test(path)) {
          return reply({
            error: 'You can not send _bulk requests to this interface.'
          }).code(400).takeover();
        }
        return reply.continue();
      }

      function noDirectIndex({ path }, reply) {
        const requestPath = trimRight(trim(path), '/');
        const matchPath = createPath('/elasticsearch', kibanaIndex);

        if (requestPath === matchPath) {
          return reply(methodNotAllowed('You cannot modify the primary kibana index through this interface.'));
        }

        reply.continue();
      }

      // These routes are actually used to deal with things such as managing
      // index patterns and advanced settings, but since hapi treats route
      // wildcards as zero-or-more, the routes also match the kibana index
      // itself. The client-side kibana code does not deal with creating nor
      // destroying the kibana index, so we limit that ability here.
      createKibiProxy(
        server,
        ['PUT', 'POST', 'DELETE'],
        `/${kibanaIndex}/{paths*}`,
        {
          pre: [ noDirectIndex, noBulkCheck ]
        }
      );
      // Set up the health check service and start it.
      const mappings = kibana.uiExports.mappings.getCombined();
      const { start, waitUntilReady } = healthCheck(this, server, { mappings });
      server.expose('waitUntilReady', waitUntilReady);
      start();
    }
  });

};

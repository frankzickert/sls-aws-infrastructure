/**
 * Starts an express-server on `localhost` that serves the client-web app on the port specified in
 * the environment variables or 3000 (default)
 */

import { parseConfiguration } from './infra-comp-utils/configuration-lib';
import { deploySls, s3sync, createSlsYaml } from './infra-comp-utils/sls-libs';
import * as deepmerge from 'deepmerge';


import {
    IConfigParseResult,
    PARSER_MODES,
    getStaticBucketName
} from 'infrastructure-components';

/**
 * uses the current serverless.yml (created by previous build!) to deploy the stack
 *
 * @param configFilePath
 */
export async function deploy (configFilePath: string, stage: string) {

    const path = require('path');
    
    // load and parse the configuration from the temporary folder
    const parsedConfig: IConfigParseResult = await parseConfiguration(configFilePath, stage, PARSER_MODES.MODE_DEPLOY);


    // (re-)create the serverless.yml
    createSlsYaml(parsedConfig.slsConfigs, true);

    // start the sls-config
    await deploySls();


    /* we can use the stage-arg here, because this is supposed to be the name of the environment anyway!
    const env = Array.isArray(parsedConfig.environments) && parsedConfig.environments.length > 0 ?
        parsedConfig.environments[0] : parsedConfig.environments;

    env !== undefined && env.name !== undefined ? env.name :*/

    const staticBucketName = getStaticBucketName(parsedConfig.stackName, parsedConfig.assetsPath, stage);

    // copy the client apps to the assets-folder
    console.log("start S3 Sync");

    await Promise.all(
        // only copy webapps
        parsedConfig.webpackConfigs.filter(wpConfig => wpConfig.target === "web").map(async wpConfig => {
            await s3sync(parsedConfig.region, staticBucketName, path.join(parsedConfig.buildPath, wpConfig.name))
        })
    );

};
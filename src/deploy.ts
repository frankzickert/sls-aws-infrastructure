/**
 * Starts an express-server on `localhost` that serves the client-web app on the port specified in
 * the environment variables or 3000 (default)
 */

import { parseConfiguration } from './infra-comp-utils/configuration-lib';
import { deploySls, s3sync, getAccountIDUsingAccessKey, createSlsYaml, runSlsCmd } from './infra-comp-utils/sls-libs';
import * as deepmerge from 'deepmerge';
import {runWebpack} from "./infra-comp-utils/webpack-libs";

import {
    frameText,
    frameTop,
    frameBottom,
    singleLine,
    emptyLine
} from './infra-comp-utils/console-output';

const clc = require('cli-color');

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
    const rimraf = require("rimraf");


    // load and parse the configuration from the temporary folder
    const parsedConfig: IConfigParseResult = await parseConfiguration(configFilePath, stage, PARSER_MODES.MODE_DEPLOY);

    // delete the build-folder
    rimraf.sync(parsedConfig.buildPath);


    // (re-)create the serverless.yml
    createSlsYaml(parsedConfig.slsConfigs, true);

    // now run the webpacks - except the web-targets
    await Promise.all(parsedConfig.webpackConfigs.filter(wpConfig => wpConfig.target !== "web").map(async wpConfig => {
        console.log("wpConfig: ", wpConfig);

        await runWebpack(wpConfig)

        console.log ("--- server webpacks done ---")
    }));

    if (parsedConfig.stackType === "SPA" ) {
        // now run the web-targets webpacks - SPA-ONLY!
        await Promise.all(parsedConfig.webpackConfigs.filter(wpConfig => wpConfig.target === "web").map(async wpConfig => {
            console.log("wpConfig: ", wpConfig);

            await runWebpack(wpConfig)

            console.log ("--- client webpacks done ---")
        }));

    }


    if (parsedConfig.stackType !== "SOA" ) {
        console.log(`running ${parsedConfig.postBuilds.length} postscripts...`);
        // now run the post-build functions
        await Promise.all(parsedConfig.postBuilds.map(async postBuild => await postBuild()));

    }


    // start the sls-config
    await deploySls(parsedConfig.stackName);


    const accountId = await getAccountIDUsingAccessKey();
    //console.log("accountId: ", accountId);
    const staticBucketName = getStaticBucketName(accountId, parsedConfig.stackName, parsedConfig.assetsPath, stage);


    // we can now retrieve the endpoints
    var endpointMsg = undefined;
    var serviceEndpoints = undefined;

    if (parsedConfig.stackType === "SPA" || parsedConfig.stackType === "SOA") {
        await require('infrastructure-components').fetchData("deploy", {
            stackname: parsedConfig.stackName,
            envi: stage,
            domain: parsedConfig.domain,
            endp: `http://${staticBucketName}.s3-website-${parsedConfig.region}.amazonaws.com`
        });

        endpointMsg = `http://${staticBucketName}.s3-website-${parsedConfig.region}.amazonaws.com`;

    }

    if (parsedConfig.stackType !== "SPA") {

        var endpointUrl = undefined;

        var eps: any = {};

        await runSlsCmd("echo $(sls info)", data => {
            //console.log("data: " , data);

            eps = data.split(" ").reduce(({inSection, endpoints}, val, idx) => {
                //console.log("eval: " , val);

                if (inSection && val.indexOf("https://") > -1) {
                    return { inSection: true, endpoints: endpoints.concat(
                        val.indexOf("{proxy+}") == -1 ? [val] : []
                    )}
                }

                if (val.startsWith("endpoints:")) {
                    return { inSection: true, endpoints: endpoints }
                }

                if (val.startsWith("functions:")) {
                    return { inSection: false, endpoints: endpoints }
                }

                return { inSection: inSection, endpoints: endpoints }

            }, {inSection: false, endpoints: []});

            //console.log("endpoints" , eps)

        }, false);


        const data = Object.assign({
            stackname: parsedConfig.stackName,
            envi: stage,
            domain: parsedConfig.domain
        }, eps.endpoints.length > 0 ? { endp: eps.endpoints[0]} : {});

        await require('infrastructure-components').fetchData("deploy", data);

        if (eps.endpoints.length > 0) {
            // the ServiceOrientedApp already has an endpoint, but it also has services
            if (endpointMsg !== undefined) {
                serviceEndpoints = eps.endpoints;
            } else {
                endpointMsg = eps.endpoints[0];
            }


        }
    }
    /// end of retrieving the endpoints!
    
    

    /* we can use the stage-arg here, because this is supposed to be the name of the environment anyway!
    const env = Array.isArray(parsedConfig.environments) && parsedConfig.environments.length > 0 ?
        parsedConfig.environments[0] : parsedConfig.environments;

    env !== undefined && env.name !== undefined ? env.name :*/


    if (parsedConfig.stackType !== "SPA") {
        // now run the web-targets webpacks - OTHER THAN SPA!
        await Promise.all(parsedConfig.webpackConfigs.filter(wpConfig => wpConfig.target === "web").map(async wpConfig => {
            console.log("wpConfig: ", wpConfig);

            await runWebpack(wpConfig)

            console.log ("--- client webpacks done ---")
        }));

    }

    //for SOA, we need to provide the endoints into the build of the client,
    // we need to run the post-scripts after the web-target webpacks!
    if (parsedConfig.stackType === "SOA" ) {
        console.log(`SOA: running ${parsedConfig.postBuilds.length} postscripts...`);
        // now run the post-build functions
        await Promise.all(parsedConfig.postBuilds.map(async postBuild => await postBuild({serviceEndpoints: serviceEndpoints})));
    }




    // copy the client apps to the assets-folder
    console.log("start S3 Sync");

    await Promise.all(
        // only copy webapps
        parsedConfig.webpackConfigs.filter(wpConfig => wpConfig.target === "web").map(async wpConfig => {
            await s3sync(parsedConfig.region, staticBucketName, path.join(parsedConfig.buildPath, wpConfig.name))
        })
    );


    
    
    if (endpointMsg !== undefined) {

        console.log(frameTop());
        console.log(emptyLine());
        console.log(frameText("Your deployment is complete!", clc.magenta.bold));
        console.log(emptyLine());

        console.log(frameText("Your React-App is now available at:", clc.magenta));
        console.log(frameText(endpointMsg, clc.green));
        console.log(emptyLine());

        if (serviceEndpoints !== undefined) {
            console.log(frameText("Your App has the following services:", clc.magenta));
            serviceEndpoints.forEach(endpoint => console.log(frameText(" - "+endpoint, clc.green)))

            console.log(emptyLine());
        }

        console.log(frameBottom());
    }

};
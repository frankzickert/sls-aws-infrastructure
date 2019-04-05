/**
 * This module must not import anything globally not workin in web-mode! if needed, require it within the functions
 */
import { IPlugin } from '../infra-comp-utils/plugin';
import { IConfigParseResult } from '../infra-comp-utils/config-parse-result';
import { isIsomorphicApp } from './iso-component';
import { resolveAssetsPath } from '../infra-comp-utils/iso-libs';

/**
 * Parameters that apply to the whole Plugin, passed by other plugins
 */
export interface IIsoPlugin {

    /**
     * path to a directory where we put the final bundles
     */
    buildPath: string,

    /**
     * path to the main config file
     */
    configFilePath: string
}

/**
 * A Plugin to detect Isomorphic-App-Components
 * @param props
 */
export const IsoPlugin = (props: IIsoPlugin): IPlugin => {

    const result: IPlugin = {
        // identify Isomorphic-App-Components
        applies: (component): boolean => {

            return isIsomorphicApp(component);
        },

        // convert the component into configuration parts
        process: (component: any, childConfigs: Array<IConfigParseResult>, infrastructureMode: string | undefined): IConfigParseResult => {

            const path = require('path');

            // we use the hardcoded name `server` as name
            const serverName = "server";

            const serverBuildPath = path.join(require("../utils/system-libs").currentAbsolutePath(), props.buildPath);

            // the isomorphic app has a server application
            const serverWebPack = require("../utils/webpack-libs").complementWebpackConfig(
                require("../utils/webpack-libs").createServerWebpackConfig(
                    "./"+path.join("node_modules", "infrastructure-scripts", "assets", "server.tsx"), //entryPath: string,
                    serverBuildPath, //use the buildpath from the parent plugin
                    serverName, // name of the server
                    {
                        __CONFIG_FILE_PATH__: require("../utils/system-libs").pathToConfigFile(props.configFilePath) // replace the IsoConfig-Placeholder with the real path to the main-config-bundle
                    }, {
                        __ISOMORPHIC_ID__: `"${component.instanceId}"`,
                        __ASSETS_PATH__: `"${component.assetsPath}"`,
                        __RESOLVED_ASSETS_PATH__: `"${resolveAssetsPath(
                            component.buildPath,
                            serverName, 
                            component.assetsPath ) 
                        }"`
                    }
                )
            );

            // provide all client configs in a flat list
            const webpackConfigs: any = childConfigs.reduce((result, config) => result.concat(config.webpackConfigs), []);

            const copyAssetsPostBuild = () => {
                console.log("now copy the assets!");

                webpackConfigs.map(config => require("../utils/system-libs").copyAssets( config.output.path, path.join(serverBuildPath, serverName, component.assetsPath)));
            };

            return {
                slsConfigs: [
                    require("../utils/sls-libs").toSlsConfig(
                        component.stackName,
                        serverName,
                        component.buildPath,
                        component.assetsPath,
                        component.region),

                    ...childConfigs.map(config => config.slsConfigs)
                ],
                
                // add the server config 
                webpackConfigs: webpackConfigs.concat([serverWebPack]),

                postBuilds: childConfigs.reduce((result, config) => result.concat(config.postBuilds), [copyAssetsPostBuild]),
            }
        }
    }

    return result;

};
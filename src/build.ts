
import { loadConfiguration } from './libs';

/**
 *
 * @param configFilePath
 */
export async function build (configFilePath: string) {

    const webpack = require('webpack');
    const config = await loadConfiguration(configFilePath);

    // TODO depending on the configuration, we might need to build more than one webpack package
    // && scripts build webpack.config.server.js && cp -rf ./dist/js/ ./build/server/assets/

    await webpack(config.webpackConfig, (err, stats) => {
        if (err) {
            console.error(err.stack || err);
            if (err.details) {
                console.error(err.details);
            }
            return;
        }

        const info = stats.toJson();

        if (stats.hasErrors()) {
            console.error(info.errors);
        }

        if (stats.hasWarnings()) {
            console.warn(info.warnings);
        }

        
    });


};

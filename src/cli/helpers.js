import 'source-map-support/register';

import path from 'path';
import chalk from 'chalk';
import { isPlainObject, isBoolean, isString, set, difference } from 'lodash';
import resolve from 'resolve';

import { merge } from '../configuration';
import { getApplicationConfig } from '../configuration/helpers';
import buildDocumentationObject from '../documentation/build-documentation-object';
import generateTable from '../documentation/generate-table';
import { getDefaultValue } from '../documentation/helpers';

function getExtension(extensionName, directory) {
    try {
        const { baseConfig, metaConfig } = require(resolve.sync(extensionName, { basedir: directory }));
        return { baseConfig, metaConfig };
    } catch (err) {
        console.log(
            chalk.bgRed(
                'Failed to load Roc extension ' + chalk.bold(extensionName) + '. ' +
                'Make sure you have it installed. Try running:'
            ) + ' ' +
            chalk.underline('npm install --save ' + extensionName)
        , '\n');
        return {};
    }}

// This needs to be exported! Could be useful to use in extensons to return thier configuration!
export function buildCompleteConfig(debug, config = {}, meta = {}, applicationConfigPath, directory = process.cwd()) {
    let finalConfig = config;
    let finalMeta = meta;

    const applicationConfig = getApplicationConfig(applicationConfigPath);

    let usedExtensions = [];
    const mergeExtension = (extensionName) => {
        // TODO Verify what happens when we try to get an extensions that isn't installed.
        const { baseConfig, metaConfig } = getExtension(extensionName, directory);

        if (baseConfig && metaConfig) {
            usedExtensions.push(extensionName);
            finalConfig = merge(finalConfig, baseConfig);
            finalMeta = merge(finalMeta, metaConfig);
        }
    };

    // If extensions are defined we will use them to merge the configurations
    if (applicationConfig.extensions && applicationConfig.extensions.length) {
        applicationConfig.extensions.forEach(mergeExtension);
    } else {
        const projectPackageJson = require(path.join(directory, 'package.json'));
        [
            ...Object.keys(projectPackageJson.dependencies || {}),
            ...Object.keys(projectPackageJson.devDependencies || {})
        ]
        .filter(dependecy => /^roc(-.+)/.test(dependecy))
        .forEach(mergeExtension);
    }

    if (usedExtensions.length && debug) {
        console.log('Will use the following Roc Extensions', usedExtensions, '\n');
    }

    // Check for a mismatch between applicaiton configuration and extensions.
    validateConfigurationStructure(finalConfig, applicationConfig);

    return {
        extensionConfig: finalConfig,
        config: merge(finalConfig, applicationConfig),
        meta: finalMeta
    };
}

function validateConfigurationStructure(config, applicationConfig) {
    const getKeys = (obj, oldPath = '', allKeys = []) => {
        Object.keys(obj).forEach((key) => {
            const value = obj[key];
            const newPath = oldPath + key;

            if (isPlainObject(value)) {
                getKeys(value, newPath + '.', allKeys);
            } else {
                allKeys.push(newPath);
            }
        });

        return allKeys;
    };

    const diff = difference(getKeys(applicationConfig), getKeys(config));
    if (diff.length > 0) {
        // TODO Do not do console.log here!
        console.log(
            chalk.bgRed('There was a mismatch in the application configuration structure, '
                + 'make sure this is correct. The following will be ignored:') + ' ' +
            diff.join(', ') +
            '\n'
        );
    }
}

export function generateCommandsDocumentation({ commands }, { commands: commandsMeta }) {
    const header = {
        name: true,
        description: true
    };

    const noCommands = {'No commands available.': ''};
    commandsMeta = commandsMeta || {};

    let table = [{
        name: 'Commands',
        objects: Object.keys(commands || noCommands).map((command) => {
            const options = commandsMeta[command] ?
                ' ' + getCommandOptionsAsString(commandsMeta[command]) :
                '';
            const description = commandsMeta[command] && commandsMeta[command].description ?
                commandsMeta[command].description :
                '';

            return {
                name: (command + options),
                description
            };
        })
    }, {
        name: 'Options',
        objects: [{
            name: '-h, --help',
            description: 'Output usage information.'
        }, {
            name: '-v, --version',
            description: 'Output version number.'
        }, {
            name: '-d, --debug',
            description: 'Enable debug mode.'
        }, {
            name: '-c, --config',
            description: `Path to configuration file, will default to ${chalk.bold('roc.config.js')} in current ` +
                `working directory.`
        }, {
            name: '-D, --directory',
            description: 'Path to working directory, will default to the current working directory. Can be either ' +
                'absolute or relative.'
        }]
    }];

    return generateTable(table, header, {
        compact: true,
        titleWrapper: (name) => name + ':',
        cellDivider: '',
        rowWrapper: (input) => `${input}`,
        header: false,
        groupTitleWrapper: (input) => input + ':'
    });
}

function getCommandOptionsAsString(command) {
    let options = '';
    (command.options || []).forEach((option) => {
        options += option.required ? `<${option.name}> ` : `[${option.name}] `;
    });

    return options;
}

/**
 * Generates plain text documentation for the provided configuration object
 *
 * Prints the documentation directly to the console.log
 *
 * @param {object} config - the configuration object to generate documentation for
 * @param {object} metaConfig - the meta configuration object that has information about the configuration object
 * @param {string} command - the current command to show information about
 * @returns {string} The documentation as a string.
 */
export function generateCommandDocumentation({ settings }, { commands, settings: meta }, command) {
    const rows = [];
    rows.push('Usage: roc ' + command + ' ' + getCommandOptionsAsString(commands[command]));
    rows.push('');

    // Only continue if the command accepts settings
    if (commands[command] && !commands[command].settings) {
        return rows.join('\n');
    }

    rows.push('Options:');

    // Generate the options table
    const filter = (commands[command].settings === true) ? [] : commands[command].settings;
    const documentationObject = buildDocumentationObject(settings, meta, filter);
    const header = {
        // TODO Change cli to true and make it work, same for the rest
        cli: {
            name: 'CLI Flag'
        },
        description: {
            name: 'Description',
            padding: false
        },
        defaultValue: {
            name: 'Default',
            renderer: (input) => {
                input = getDefaultValue(input);

                if (!input) {
                    return chalk.yellow('No default value');
                }

                return chalk.cyan(input);
            }
        }
    };

    rows.push(generateTable(documentationObject, header, {
        compact: true,
        titleWrapper: (name) => name + ':',
        cellDivider: '',
        rowWrapper: (input) => `${input}`,
        header: false,
        groupTitleWrapper: (input) => input + ':'
    }));

    return rows.join('\n');
}

export function parseOptions(command, meta, options) {
    // If the command supports options
    if (meta[command] && meta[command].options) {
        let parsedArguments = {};
        meta[command].options.forEach((option, index) => {
            const value = options[index];

            if (option.required && !value) {
                throw new Error(`Required option "${option.name}" was not provided.`);
            }

            if (option.validation && !option.validation(value)) {
                throw new Error(`Validation failed for option "${option.name}". `
                    + `Should be ${option.validation(null, true)}.`);
            }

            parsedArguments[option.name] = value;
        });

        return {
            arguments: parsedArguments,
            rest: options.splice(Object.keys(parsedArguments).length)
        };
    }

    return {
        arguments: undefined,
        rest: options
    };
}

export function getMappings(documentationObject) {
    const recursiveHelper = (groups) => {
        let mappings = {};

        groups.forEach((group) => {
            group.objects.forEach((element) => {
                // Remove the two dashes in the beginning to match correctly
                mappings[element.cli.substr(2)] = {
                    path: element.path,
                    convertor: getConvertor(element.defaultValue, element.cli),
                    validator: element.validator
                };
            });

            mappings = Object.assign({}, mappings, recursiveHelper(group.children));
        });

        return mappings;
    };

    return recursiveHelper(documentationObject);
}

// Convert values based on their default value
function getConvertor(value, name) {
    if (isBoolean(value)) {
        return (input) => {
            if (isBoolean(input)) {
                return input;
            }
            if (input === 'true' || input === 'false') {
                return input === 'true';
            }

            // TODO Do not have console.log here!
            console.log(`Invalid value given for ${chalk.bold(name)}. Will use the default ` +
                `${chalk.bold(value)}.`);

            return value;
        };
    } else if (Array.isArray(value)) {
        return (input) => {
            let parsed;
            try {
                parsed = JSON.parse(input);
            } catch (err) {
                // Ignore this case
            }

            if (Array.isArray(parsed)) {
                return parsed;
            }

            return input.toString().split(',');
        };
    } else if (Number.isInteger(value)) {
        return (input) => parseInt(input, 10);
    } else if (!isString(value) && (!value || Object.keys(value).length === 0)) {
        return (input) => JSON.parse(input);
    }

    return (input) => input;
}

export function parseArguments(args, mappings) {
    const config = {};

    Object.keys(args).forEach((key) => {
        if (mappings[key]) {
            const value = convert(args[key], mappings[key]);
            set(config, mappings[key].path, value);
        } else {
            // TODO Do not do console.log here
            console.log('I did not understand: ', key);
        }
    });

    return config;
}

function convert(value, mapping) {
    // Maybe we can let the validation happen later?
    // Should in reallity be managed when we do validation on everything
    const val = mapping.convertor(value);
    if (mapping.validator(val)) {
        return val;
    }
}

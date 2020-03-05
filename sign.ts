import * as yargs from 'yargs';

const argv = yargs.command('$0 <path>', 'Automatically zip and sign a SketchUp extension via the Extension Warehouse web interface.', yargs =>
{
    yargs.positional('path', {
        describe: 'Path to the folder that contains the extension (must contain an [extension].rb file and an [extension] folder)',
        demandOption: true,
        type: 'string'
    })
    .options({
        'env': {
            describe: 'Look for a dotenv file that contains the EW_USERNAME and EW_PASSWORD fields',
            type: 'boolean',
            default: false
        },
        'username': {
            describe: 'Extension Warehouse username (will be prompted for if not provided and --env is not specified)',
            type: 'string',
            default: '',
        },
        'password': {
            describe: 'Extension Warehouse password (will be prompted for if not provided and --env is not specified)',
            type: 'string',
            default: ''
        },
        'output': {
            describe: 'Path to download the signed extension to',
            type: 'string'
        }
    })
    .group(['env', 'username', 'password'], 'Authentication')
    .example('$0 my_extension', 'Will require manual username and password input')
    .example('$0 my_extension --username user@name.com', 'Will require manual password input')
    .example('$0 my_extension --env', 'will use the credentials stored in a dotenv file, no manual input');
})
.help()
.wrap(null)
.argv;

/* Retrieve the Extension Warehouse credentials to use */

import { config } from 'dotenv';
import * as prompts from 'prompts';

async function getCredentials() : Promise<[string, string]>
{
    // Use the credentials provided via the CLI by default (could be undefined)

    let username = argv.username;
    let password = argv.password;

    // Look for the .env credentials if --env has been specified

    if (argv.env)
    {
        const envFound = config();

        if (envFound.error)
        {
            console.error(`Specified --env option but cannot load .env (${envFound.error})`);
            process.exit(1);
        }
        else if (!process.env.EW_USERNAME)
        {
            console.error('Specified --env option but the EW_USERNAME variable is missing');
            process.exit(1);
        }
        else if (!process.env.EW_PASSWORD)
        {
            console.error('`Specified --env option but the EW_PASSWORD variable is missing');
            process.exit(1);
        }
        else
        {
            username = process.env.EW_USERNAME;
            password = process.env.EW_PASSWORD;
        }
    }

    // If some info is missing, prompt the user

    if (!username)
    {
        username = await (await prompts({ type: 'text', name: 'username', message: 'Extension Warehouse username' })).username;
    }

    if (!password)
    {
        password = await (await prompts({ type: 'password', name: 'password', message: 'Extension Warehouse password' })).password;
    }

    return [username as string, password as string];
}

/* Zip the extension's files */

import * as archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';

async function zip() : Promise<string>
{
    // Check that provided path exists and that it points to a folder

    if (!fs.existsSync(argv.path as string) || !fs.lstatSync(argv.path as string).isDirectory())
    {
        console.error(`The target path "${argv.path as string}" is not a directory`);
        process.exit(0);
    }

    // Create the archive

    const archive = archiver('zip');

    archive.on('warning', (error) =>
    {
        if (error.code === 'ENOENT')
        {
            console.warn(`Error while preparing the archive: ${error.message}`);
        }
        else
        {
            throw error;
        }
    });

    archive.on('error', (error) =>
    {
        throw error;
    });

    const zipPath = `extension_${new Date().getTime()}.zip`;
    const file = fs.createWriteStream(zipPath);
    archive.pipe(file);

    archive.directory(argv.path as string, false);
    archive.finalize();

    // Rename to rbz

    const rbzPath = `${path.parse(zipPath).name}.rbz`;
    fs.renameSync(zipPath, rbzPath);

    console.info(`The extension has been archived in "${rbzPath}"`);

    return rbzPath;
}

/* Log in, upload and download the signed extension */

import * as download from 'download';
import * as puppeteer from 'puppeteer';

async function sign(zipPath: string, username: string, password: string, output: string) : Promise<void>
{
    console.info('Starting the signing process...');

    const browser = await puppeteer.launch({headless: false, slowMo: 10});

    const page = await browser.newPage();
    await page.goto('https://extensions.sketchup.com/extension/sign', {waitUntil: 'networkidle0'});

    // Sign in

    const signinButton = await page.waitFor('.intro-section button', {visible: true});
    await signinButton.click();

    const emailIntput = await page.waitFor('input[id=email]', {visible: true});
    await emailIntput.type(username);
    await page.click('input[id=next]');

    const passwordInput = await page.waitFor('input[id=password]', {visible: true});
    await passwordInput.type(password);
    await page.click('input[id=submit]');

    // Upload

    const signButton = await page.waitFor('.intro-section button', {visible: true});
    await signButton.click();

    await page.waitFor(5000); // We have to wait a bit or the next step fails

    const browseButton = await page.waitFor('label[for=file]', {visible: true});
    const [fileChooser] = await Promise.all([
        page.waitForFileChooser(),
        browseButton.click()
    ]);
    await fileChooser.accept([zipPath]);

    const nextButton = await page.waitFor('.md-modal:nth-child(1) button.primary', {visible: true});
    await nextButton.click();

    const nextButton2 = await page.waitFor('.md-modal:nth-child(2) button.primary', {visible: true});
    await nextButton2.click();

    // Download

    const downloadButton = await page.waitFor('a.link-button')
    const downloadUrl = await downloadButton.evaluate(a => (a as HTMLLinkElement).href);

    console.log(`Downloading ${downloadUrl}...`);

    const outputName = `${path.parse(zipPath).name}_signed.rbz`;

    try
    {
        await download(downloadUrl, '.', { filename: outputName });
    }
    catch
    {
        console.error(`Download failed!`);
    }

    console.info(`Downloaded to "${outputName}"`);

    await browser.close();

    // Move the download file to the output path if required

    if (output)
    {
        fs.renameSync(outputName, output);
    }

    return null;
};

/* Main function */

async function main()
{
    let [username, password] = await getCredentials();
    let zipPath = await zip();
    await sign(zipPath, username, password, argv.output as string);
}

main();

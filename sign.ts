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
            describe: 'Path to a dotenv file that contains the EW_USERNAME and EW_PASSWORD fields ("--env" without path will look in the current working dir)',
            type: 'string'
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
        },
        headless: {
            describe: 'Run in headless mode without showing the browser',
            type: 'boolean',
            default: false
        },
        timeout: {
            describe: 'The process will fail after this timeout if nothing happens (in milliseconds)',
            type: 'number',
            default: 60000
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
import 'path';

async function getCredentials() : Promise<[string, string]>
{
    // Use the credentials provided via the CLI by default (could be undefined)

    let username = argv.username;
    let password = argv.password;

    // Look for the .env credentials if --env has been specified

    if (argv.env !== undefined)
    {
        // "--env" without path: just use the CWD
        // "--env <path>": load the custom dotenv file

        const envPath = (argv.env as string).length > 0 ?
            argv.env as string :
            '.env';

        const envFound = config({path: envPath as string});

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

async function zip(output: string) : Promise<string>
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

    const rbzPath = `${path.join(path.dirname(output), path.parse(output).name)}_not_signed.rbz`;

    const file = fs.createWriteStream(rbzPath);
    archive.pipe(file);

    archive.directory(argv.path as string, false);
    archive.finalize();

    console.info(`The extension has been archived in "${rbzPath}"`);

    return rbzPath;
}

/* Log in, upload and download the signed extension */

import * as download from 'download';
import * as puppeteer from 'puppeteer';

async function search(targetName: string, page: puppeteer.Page, selector: string) : Promise<puppeteer.ElementHandle>
{
    console.log(`Searching ${targetName}...`);

    try
    {
        return await page.waitFor(selector, {visible: true});
    }
    catch (e)
    {
        console.error(`cannot find ${targetName}: ${e}`);
        process.exit(1);
    }
}

async function sign(rbzPath: string, username: string, password: string) : Promise<void>
{
    console.info('Starting the signing process...');

    const browser = await puppeteer.launch({headless: (argv.headless as boolean), slowMo: 10});

    const page = await browser.newPage();
    await page.goto('https://extensions.sketchup.com/extension/sign', {waitUntil: 'networkidle0'});

    page.setDefaultTimeout(argv.timeout as number);

    // Sign in

    const signinButton = await search('sign in button', page, '.intro-section button');
    await signinButton.click();

    const emailIntput = await search('e-mail input', page, 'input[id=email]');
    await emailIntput.type(username);
    await page.click('input[id=next]');

    const passwordInput = await search('password input', page, 'input[id=password]');
    await passwordInput.type(password);
    await page.click('input[id=submit]');

    // Upload

    const signButton = await search('sign button', page, '.intro-section button');
    await signButton.click();

    await page.waitFor(10000); // We have to wait a bit or the next step fails

    const browseButton = await search('browse button', page, 'label[for=file]');
    const [fileChooser] = await Promise.all([
        page.waitForFileChooser(),
        browseButton.click()
    ]);
    await fileChooser.accept([rbzPath]);

    const nextButton = await search('next button 1', page, '.md-modal:nth-child(1) button.primary');
    await nextButton.click();

    const nextButton2 = await search('next button 2', page, '.md-modal:nth-child(2) button.primary');
    await nextButton2.click();

    // Download

    const downloadButton = await search('download link', page, 'a.link-button')
    const downloadUrl = await downloadButton.evaluate(a => (a as HTMLLinkElement).href);

    console.log(`Downloading ${downloadUrl}...`);

    const outputPath = path.join(path.dirname(rbzPath), `${path.basename(rbzPath, '_not_signed.rbz')}_signed.rbz`);

    try
    {
        await download(downloadUrl, path.dirname(outputPath), { filename: path.basename(outputPath) });
    }
    catch
    {
        console.error(`Download failed!`);
    }

    console.info(`Downloaded to "${outputPath}"`);

    await browser.close();

    return null;
};

/* Main function */

async function main()
{
    // Create the output directory

    const output = argv.output as string;

    if (output)
    {
        const outputDir = path.dirname(output);

        if (!fs.existsSync(outputDir))
        {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    // Run

    let [username, password] = await getCredentials();
    let rbzPath = await zip(output);
    await sign(rbzPath, username, password);
}

main();

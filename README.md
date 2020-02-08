# Automatic SketchUp Extension Signing

SketchUp extensions [must be signed before publication](https://help.sketchup.com/en/extension-warehouse/extension-encryption-and-signing).

While relatively quick, this process has to be conducted manually.
This makes it impractical for developers to integrate the signing step in an automated build pipeline.

This script automates the signing process and performs the following steps:
- Archive the extension into an `rbz` file
- Log into the Extension Warehouse
- Upload the extension and download the signed version

It is written in Typescript and uses the [Puppeteer browser automation framework](https://github.com/puppeteer/puppeteer).

## Usage

[Node.js](https://nodejs.org/) must be installed.

For the first use, install the dependencies with the Node Package Manager:

`> npm install`

Then, run the locally installed Typescript runtime with the name of the script, followed by arguments:

`> ./node_modules/.bin/ts-node sign.ts <path to the extension folder>`

## Extension Warehouse authentication

The script requires authentication credentials in order to log into the Extension Warehouse.

If none are provided, the script will prompt the user for a username and a password.
To avoid this interruption, you can provide the credentials via the command-line:

`> ./node_modules/.bin/ts-node sign.ts my_extension --username <your username> --password <your password>`

Alternatively, when no manual input is preferred, the script can fetch the credentials from a [dotenv](https://github.com/motdotla/dotenv#readme) file when the `--env` option is specified:

`> ./node_modules/.bin/ts-node sign.ts my_extension --env`

It expects the `.env` file to define the `EW_USERNAME` and `EW_PASSWORD` variables.
For convenience, you can rename and modify `.env.example`.

## Help

`> ./node_modules/.bin/ts-node sign.ts --help` for more info

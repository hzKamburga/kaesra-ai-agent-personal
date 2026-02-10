#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("{{PROJECT_NAME}} hazir. Komut ver: node bin/cli.js merhaba");
  process.exit(0);
}

const input = args.join(" ");
console.log(`[{{PROJECT_NAME}}] ${input}`);

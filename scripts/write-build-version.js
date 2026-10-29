import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";

const version=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(!version)throw new Error("Git commit SHA is unavailable");
mkdirSync("public",{recursive:true});
writeFileSync("public/build-version.json",JSON.stringify({version})+"\n");
console.log("Generated public build version "+version);

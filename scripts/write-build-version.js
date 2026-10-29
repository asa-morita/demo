import {execFileSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";

const version=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const commitMessage=execFileSync("git",["log","-1","--format=%B"],{encoding:"utf8"}).trim();
const pullRequestMatch=commitMessage.match(/\\(#(\\d+)\\)$/m);
const latestPr=pullRequestMatch?Number(pullRequestMatch[1]):null;
if(!version)throw new Error("Git commit SHA is unavailable");
mkdirSync("public",{recursive:true});
writeFileSync("public/build-version.json",JSON.stringify({version,...(latestPr?{latestPr}:{})})+"\\n");
console.log("Generated public build version "+version+(latestPr?" for PR #"+latestPr:""));

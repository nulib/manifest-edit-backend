#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { ManifestEditorBackendStack } from "../lib/cdk-stack";
import { loadBuildConfig } from "../config/load-build-config";

const app = new cdk.App();

async function main() {
  const buildConfig = await loadBuildConfig() || "{}"; //TODO: Typescript - fix this
  const buildConfigJson = JSON.parse(buildConfig);

  const stack = new ManifestEditorBackendStack(app, "ManifestEditorBackend", {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    ...buildConfigJson
  });

  cdk.Tags.of(stack).add("Project", "maktaba");
}

main();


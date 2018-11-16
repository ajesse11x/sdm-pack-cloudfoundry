/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    asSpawnCommand,
    execIn,
    logger,
    ProjectOperationCredentials,
    RemoteRepoRef,
    SpawnCommand,
    stringifySpawnCommand,
} from "@atomist/automation-client";
import {
    DelimitedWriteProgressLogDecorator,
    DeployableArtifact,
    Deployer,
    ProgressLog,
    ProjectLoader,
    spawnAndWatch,
} from "@atomist/sdm";
import { spawn } from "child_process";
import {
    CloudFoundryDeployment,
    CloudFoundryInfo,
    CloudFoundryManifestPath,
} from "../api/CloudFoundryTarget";
import { parseCloudFoundryLogForEndpoint } from "./cloudFoundryLogParser";

/**
 * Spawn a new process to use the Cloud Foundry CLI to push.
 * Note that this isn't thread safe concerning multiple logins or spaces.
 */
export class CommandLineCloudFoundryDeployer implements Deployer<CloudFoundryInfo, CloudFoundryDeployment> {

    constructor(private readonly projectLoader: ProjectLoader) {
    }

    public async deploy(da: DeployableArtifact,
                        cfi: CloudFoundryInfo,
                        log: ProgressLog,
                        credentials: ProjectOperationCredentials): Promise<CloudFoundryDeployment[]> {
        logger.info("Deploying app [%j] to Cloud Foundry [%s]", da, cfi.description);

        // We need the Cloud Foundry manifest. If it's not found, we can't deploy
        // We want a fresh version unless we need it build
        return this.projectLoader.doWithProject({ credentials, id: da.id, readOnly: !da.cwd }, async project => {
            const manifestFile = await project.findFile(CloudFoundryManifestPath);

            if (!cfi.api || !cfi.org || !cfi.username || !cfi.password) {
                throw new Error("Cloud foundry authentication information missing. See CloudFoundryTarget.ts");
            }

            const opts = {};

            // Note: if the password is wrong, things hangs forever waiting for input.
            await execIn(
                !!da.cwd ? da.cwd : project.baseDir,
                `cf login`,
                [`-a ${cfi.api}`, `-o ${cfi.org}`, `-u ${cfi.username}`, `-p '${cfi.password}'`, `-s ${cfi.space}`]);
            logger.debug("Successfully selected space [%s]", cfi.space);
            // Turn off color so we don't have unpleasant escape codes in stream
            await execIn(da.cwd, `cf config`, ["--color false"]);
            const spawnCommand: SpawnCommand = {
                command: "cf",
                args: [
                    "push",
                    da.name,
                    "-f",
                    project.baseDir + "/" + manifestFile.path,
                    "--random-route"]
                    .concat(
                        !!da.filename ?
                            ["-p",
                                da.filename] :
                            []),
            };

            logger.info("About to issue Cloud Foundry command %s: options=%j",
                stringifySpawnCommand(spawnCommand), opts);
            const childProcess = spawn(spawnCommand.command, spawnCommand.args, opts);
            const newLineDelimitedLog = new DelimitedWriteProgressLogDecorator(log, "\n");
            childProcess.stdout.on("data", what => newLineDelimitedLog.write(what.toString()));
            childProcess.stderr.on("data", what => newLineDelimitedLog.write(what.toString()));
            return [await new Promise<CloudFoundryDeployment>((resolve, reject) => {
                childProcess.addListener("exit", (code, signal) => {
                    if (code !== 0) {
                        reject(`Error: code ${code}`);
                    }
                    resolve({
                        endpoint: parseCloudFoundryLogForEndpoint(log.log),
                        appName: da.name,
                    });
                });
                childProcess.addListener("error", reject);
            })];
        });
    }

    public async findDeployments(id: RemoteRepoRef,
                                 ti: CloudFoundryInfo,
                                 credentials: ProjectOperationCredentials): Promise<CloudFoundryDeployment[]> {
        logger.warn("Find Deployments is not implemented in CommandLineCloudFoundryDeployer." +
            " You should probably use the CloudFoundryBlueGreenDeployer anyway.");
        return [];
    }

    public async undeploy(
        cfi: CloudFoundryInfo,
        deployment: CloudFoundryDeployment,
        log: ProgressLog): Promise<void> {
        await spawnAndWatch(asSpawnCommand(
            `cf login -a ${cfi.api} -o ${cfi.org} -u ${cfi.username} -p '${cfi.password}' -s ${cfi.space}`),
            {}, log);

        await spawnAndWatch(asSpawnCommand(`cf delete ${deployment.appName}`), {}, log);
        return;
    }

    public logInterpreter(log: string) {
        return {
            relevantPart: "",
            message: "Deploy failed",
        };
    }

}

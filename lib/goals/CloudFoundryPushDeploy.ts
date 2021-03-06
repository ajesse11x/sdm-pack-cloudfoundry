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

import { logger } from "@atomist/automation-client";
import {
    checkOutArtifact,
    DefaultGoalNameGenerator,
    Deployer,
    ExecuteGoal,
    ExecuteGoalResult,
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    getGoalDefinitionFrom,
    Goal,
    GoalDefinition,
    GoalInvocation,
    ImplementationRegistration,
    IndependentOfEnvironment,
} from "@atomist/sdm";
import * as _ from "lodash";
import { CommandLineCloudFoundryDeployer } from "../cli/CommandLineCloudFoundryDeployer";
import { EnvironmentCloudFoundryTarget } from "../config/EnvironmentCloudFoundryTarget";
import { CloudFoundryBlueGreenDeployer } from "../push/CloudFoundryBlueGreenDeployer";
import { CloudFoundryPushDeployer } from "../push/CloudFoundryPushDeployer";

/**
 * Register a deployment for a certain type of push
 */
export interface CloudFoundryDeploymentRegistration extends Partial<ImplementationRegistration> {
    environment: ("staging" | "production");
    strategy: CloudFoundryDeploymentStrategy;
}

export enum CloudFoundryDeploymentStrategy {
    BLUE_GREEN,
    API,
    CLI,
}

const CloudFoundryGoalDefinition: GoalDefinition = {
    displayName: "deploying to Cloud Foundry",
    uniqueName: "cloudfoundry-deploy",
    environment: IndependentOfEnvironment,
    workingDescription: "Deploying to Cloud Foundry",
    completedDescription: "Deployed to Cloud Foundry",
    failedDescription: "Deployment to Cloud Foundry failed",
    waitingForApprovalDescription: "Waiting for Cloud Foundry deployment approval",
    waitingForPreApprovalDescription: "Waiting to start Cloud Foundry deployment",
    stoppedDescription: "Deployment to Cloud Foundry stopped",
    canceledDescription: "Deployment to Cloud Foundry cancelled",
};

/**
 * Goal to deploy to Cloud Foundry. This uses blue/green deployment.
 */
export class CloudFoundryDeploy extends FulfillableGoalWithRegistrations<CloudFoundryDeploymentRegistration> {
    // tslint:disable-next-line
    constructor(protected details: FulfillableGoalDetails | string = DefaultGoalNameGenerator.generateName("cf-deploy-push"),
                ...dependsOn: Goal[]) {

        super({
            ...CloudFoundryGoalDefinition,
            ...getGoalDefinitionFrom(details, DefaultGoalNameGenerator.generateName("cf-deploy-push")),
        }, ...dependsOn);
    }

    public with(registration: CloudFoundryDeploymentRegistration): this {
        this.addFulfillment({
            name: DefaultGoalNameGenerator.generateName("cf-deployer"),
            goalExecutor: executeCloudFoundryDeployment(registration),
            ...registration,
        });
        return this;
    }
}

function executeCloudFoundryDeployment(registration: CloudFoundryDeploymentRegistration): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { sdmGoal, credentials, id, context, progressLog, configuration } = goalInvocation;
        const atomistTeam = context.workspaceId;

        logger.info("Deploying project %s:%s to CloudFoundry in %s]", id.owner, id.repo, registration.environment);

        const artifactCheckout = await checkOutArtifact(_.get(sdmGoal, "push.after.image.imageName"),
            configuration.sdm.artifactStore, id, credentials, progressLog);

        artifactCheckout.id.branch = sdmGoal.branch;

        let deployer: Deployer;
        switch (registration.strategy) {
            case CloudFoundryDeploymentStrategy.BLUE_GREEN:
                deployer = new CloudFoundryBlueGreenDeployer(configuration.sdm.projectLoader);
                break;
            case CloudFoundryDeploymentStrategy.API:
                deployer = new CloudFoundryPushDeployer(configuration.sdm.projectLoader);
                break;
            case CloudFoundryDeploymentStrategy.CLI:
                deployer = new CommandLineCloudFoundryDeployer(configuration.sdm.projectLoader);
                break;
        }

        const deployments = await deployer.deploy(
            artifactCheckout,
            new EnvironmentCloudFoundryTarget(registration.environment),
            progressLog,
            credentials,
            atomistTeam);

        const results = await Promise.all(deployments.map(deployment => {
            return {
                code: 0,
                targetUrl: deployment.endpoint,
            };
        }));

        return _.head(results);
    };
}

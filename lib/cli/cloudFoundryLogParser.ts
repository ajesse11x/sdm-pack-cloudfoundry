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

import { configurationValue } from "@atomist/automation-client";
import {
    isPatternMatch,
    Microgrammar,
} from "@atomist/microgrammar";

/**
 * Use a microgrammar to parse the Cloud Foundry log to extract the endpoint
 * url if found. Look for urls: or routes: style exposure in log.
 */
export function parseCloudFoundryLogForEndpoint(cfLog: string): string | undefined {
    const r = routes.firstMatch(cfLog) || urls.firstMatch(cfLog);
    if (isPatternMatch(r)) {
        if (!r.endpoint.startsWith("http://")) {
            return `${configurationValue<string>("sdm.cloudfoundry.endpoint.protocol", "http")}://${r.endpoint}`;
        }
        return r.endpoint;
    }
    return undefined;
}

// The cf cli changed from returning urls to routes in a recent version
const routes = Microgrammar.fromString<{ endpoint: string }>(
    // tslint:disable-next-line:no-invalid-template-strings
    "routes:${endpoint}",
    {
        endpoint: /[http:\/\/]?[a-zA-Z0-9\-.]+/,
    },
);

// Old style urls value
const urls = Microgrammar.fromString<{ endpoint: string }>(
    // tslint:disable-next-line:no-invalid-template-strings
    "urls:${endpoint}",
    {
        endpoint: /[http:\/\/]?[a-zA-Z0-9\-.]+/,
    },
);

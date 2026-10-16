import * as AzureDevOps from "@t3tools/source-control-azure-devops/client/definition";
import * as Bitbucket from "@t3tools/source-control-bitbucket/client/definition";
import {
  makeSourceControlClientRegistry,
  readSourceControlHostSettings,
  defineSourceControlClient,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
} from "@t3tools/source-control-core/client/definition";
import { SourceControlProviderKind, type ServerSettings } from "@t3tools/contracts";

export {
  UNKNOWN_SOURCE_CONTROL_CLIENT,
  type ChangeRequestTerminology,
  type SourceControlClientDefinition,
} from "@t3tools/source-control-core/client/definition";
import * as Forgejo from "@t3tools/source-control-forgejo/client/definition";
import * as GitCafe from "@t3tools/source-control-gitcafe/client/definition";
import * as GitHub from "@t3tools/source-control-github/client/definition";
import * as GitLab from "@t3tools/source-control-gitlab/client/definition";

const GITEA_KIND = SourceControlProviderKind.make("gitea");
const gitea = defineSourceControlClient({
  ...Forgejo.definition,
  kind: GITEA_KIND,
  label: "Gitea",
  pickerLabel: "Gitea",
  icon: "gitea",
  publicHost: "gitea.com",
  publishDescription: "gitea.com",
  publishHost: (signedInHost) => signedInHost ?? "gitea.com",
  checkoutCommand: ({ number }) => `tea pr checkout ${number}`,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(GITEA_KIND, identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(GITEA_KIND, identity, link),
  isChangeRequestUrl: (url) => {
    try {
      return (
        new URL(url).hostname.split(".").includes("gitea") &&
        Forgejo.definition.isChangeRequestUrl(url)
      );
    } catch {
      return false;
    }
  },
});

/**
 * GitHub comes first because a repository that has not reported its host yet reads as GitHub,
 * which is what clients have always shown there. A change request URL goes to the first host
 * whose shape it has, so GitCafe, which claims `/pulls/` only on its own hostnames, comes before
 * Forgejo, which claims it everywhere.
 */
const BUILT_IN_SOURCE_CONTROL_CLIENTS = [
  GitHub.definition,
  GitLab.definition,
  GitCafe.definition,
  gitea,
  Forgejo.definition,
  Bitbucket.definition,
  AzureDevOps.definition,
];

export const sourceControlClients = makeSourceControlClientRegistry(
  BUILT_IN_SOURCE_CONTROL_CLIENTS,
);

export type { GitHubSettings } from "@t3tools/source-control-github/client/definition";

export function readGitHubSettings(settings: Pick<ServerSettings, "sourceControlHosts">) {
  return readSourceControlHostSettings(GitHub.settings, settings.sourceControlHosts.github);
}

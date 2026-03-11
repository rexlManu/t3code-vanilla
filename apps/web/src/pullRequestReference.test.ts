import { describe, expect, it } from "vitest";

import { parsePullRequestReference } from "./pullRequestReference";

describe("parsePullRequestReference", () => {
  it("accepts GitHub pull request URLs", () => {
    expect(parsePullRequestReference("https://github.com/pingdotgg/t3code/pull/42")).toBe(
      "https://github.com/pingdotgg/t3code/pull/42",
    );
  });

  it("accepts GitLab merge request URLs", () => {
    expect(
      parsePullRequestReference("https://gitlab.example.com/group/subgroup/t3code/-/merge_requests/42"),
    ).toBe("https://gitlab.example.com/group/subgroup/t3code/-/merge_requests/42");
  });

  it("accepts Gitea pull request URLs", () => {
    expect(parsePullRequestReference("https://gitea.example.com/pingdotgg/t3code/pulls/42")).toBe(
      "https://gitea.example.com/pingdotgg/t3code/pulls/42",
    );
  });

  it("accepts raw numbers", () => {
    expect(parsePullRequestReference("42")).toBe("42");
  });

  it("accepts #number references", () => {
    expect(parsePullRequestReference("#42")).toBe("#42");
  });

  it("rejects non-pull-request input", () => {
    expect(parsePullRequestReference("feature/my-branch")).toBeNull();
  });
});

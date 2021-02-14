import { debug } from "@actions/core";
import { Context } from "@actions/github/lib/context";
import type { GitHub } from "@actions/github/lib/utils";
import { promises } from "fs";
import humanizeDuration from "humanize-duration";
import { join } from "path";
import { exec } from "shelljs";
import { addDetailsToLabels } from "../github";
import { BookResult } from "../google-books";

export const updateSummary = async (
  owner: string,
  repo: string,
  context: Context,
  octokit: InstanceType<typeof GitHub>
) => {
  debug("Starting updateSummary");
  const issues = await octokit.issues.listForRepo({
    owner: context.issue.owner,
    repo: context.issue.repo,
    labels: "book",
    state: "all",
  });
  debug(`Got ${issues.data.length} issues`);
  const api: (BookResult & {
    state: "reading" | "completed";
    startedAt: string;
    completedAt?: string;
    timeToComplete?: number;
    timeToCompleteFormatted?: string;
  })[] = [];
  for await (const issue of issues.data) {
    const comments = await octokit.issues.listComments({
      owner: context.issue.owner,
      repo: context.issue.repo,
      issue_number: issue.number,
    });
    debug(`Got ${comments.data.length} comments in issue ${issue.number}`);
    let json: BookResult | undefined = undefined;
    try {
      comments.data.forEach((comment) => {
        if (comment.body.includes("Book details (JSON)"))
          json = JSON.parse(comment.body.split("```json")[1].split("```")[0]) as BookResult;
      });
    } catch (error) {
      console.log("JSON parsing error", error);
    }
    if (json)
      api.push({
        ...(json as BookResult),
        state: issue.state === "open" ? "reading" : "completed",
        startedAt: new Date(issue.created_at).toISOString(),
        completedAt: issue.state === "closed" ? new Date(issue.closed_at).toISOString() : undefined,
        timeToComplete:
          issue.state === "closed"
            ? new Date(issue.closed_at).getTime() - new Date(issue.created_at).getTime()
            : undefined,
        timeToCompleteFormatted:
          issue.state === "closed"
            ? humanizeDuration(
                new Date(issue.closed_at).getTime() - new Date(issue.created_at).getTime()
              )
            : undefined,
      });
  }
  await promises.writeFile(join(".", "api.json"), JSON.stringify(api, null, 2) + "\n");
  debug("Written api.json file");
  const apiLeft = api.filter((_, i) => i % 2 !== 0);
  const apiRight = api.filter((_, i) => i % 2 === 0);
  let mdContent = "<table>";
  [apiLeft, apiRight].forEach((apiItem) => {
    apiLeft.forEach((_, i) => {
      mdContent += "<tr>";
      if (apiItem[i])
        mdContent += `<td>
    <table>
      <tr>
        <td>
          <img alt="" src="${apiItem[i].image}" height="128">
        </td>   
        <td>
          <strong>${apiItem[i].title}</strong><br>
          ${apiItem[i].authors.join(", ")}<br><br>
          ${apiItem[i].state === "completed" ? "✔️ Completed" : "⌛ Reading"}<br>
          ${
            apiItem[i].timeToComplete
              ? `⌛ ${humanizeDuration((apiItem[i].timeToComplete || 0) * 60000)}`
              : ""
          }
          ${
            apiItem[i].completedAt
              ? `📅 ${new Date(apiItem[i].completedAt || 0).toLocaleDateString("en", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}`
              : ""
          }
        </td>
      </tr>
    </table>
  </td>
  `;
      mdContent += "</tr>";
    });
  });
  mdContent += "</table>";
  const content = await promises.readFile(join(".", "README.md"), "utf8");
  debug(`Read README.md file of length ${content.length}`);
  await promises.writeFile(
    join(".", "README.md"),
    content.split("<!--start:book-tracker-->")[0] +
      `<!--start:book-tracker-->\n${mdContent}\n<!--end:book-tracker-->` +
      content.split("<!--end:book-tracker-->")[1]
  );
  debug("Written README.md file");
  exec(`git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"`);
  exec(`git config --global user.name "github-actions[bot]"`);
  debug("Added git config user details");
  exec("git add .");
  exec('git commit -m ":bento: Update API and README summary [skip ci]"');
  debug("Committed to git history");
  exec("git push");
  debug("Pushed to repository");
  await addDetailsToLabels(owner, repo, octokit);
  debug("Updated label details");
};
import { describe, expect, it } from "vitest";
import { keyLines } from "./key-lines";

// Shaped like a real Greenhouse posting after htmlToText
const POSTING = `About the team
We build the payments platform used by millions.
What you'll do
• Ship backend services in Go and Python
What we're looking for
• Bachelor's degree in Computer Science or a related field, graduating by June 2027
• 0-2 years of professional software engineering experience (internships count)
• Strong fundamentals in data structures
Logistics
This role is hybrid: three days a week in our New York office.
We are unable to sponsor visas for this role.
The base salary range for this role is $150,000 - $180,000.`;

describe("keyLines", () => {
  it("picks experience, degree, visa, workplace and pay lines, in that order", () => {
    expect(keyLines(POSTING)).toEqual([
      {
        topic: "experience",
        text: "0-2 years of professional software engineering experience (internships count)",
      },
      {
        topic: "degree",
        text: "Bachelor's degree in Computer Science or a related field, graduating by June 2027",
      },
      { topic: "visa", text: "We are unable to sponsor visas for this role." },
      {
        topic: "workplace",
        text: "This role is hybrid: three days a week in our New York office.",
      },
      { topic: "pay", text: "The base salary range for this role is $150,000 - $180,000." },
    ]);
  });

  it("returns nothing without a description", () => {
    expect(keyLines(null)).toEqual([]);
    expect(keyLines("")).toEqual([]);
  });
});

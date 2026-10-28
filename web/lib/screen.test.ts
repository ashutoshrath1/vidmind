import assert from "node:assert/strict";
import { test } from "node:test";
import { highlight, isCode, screenBlocks, screenText, searchFrames } from "./screen.ts";

const frames = [
  { at: 1, url: "frames/0.jpg", text: "API Gateway\nSpring Cloud Netflix\nEureka Server" },
  { at: 40, url: "frames/1.jpg", text: "" },
  { at: 87.8, url: "frames/2.jpg", text: "Config Server\n$ git clone https://github.com/x/y.git" },
];

test("search: every word must appear, any case or order; empty query keeps frames with text", () => {
  assert.deepEqual(searchFrames(frames, "eureka").map((f) => f.at), [1]);
  assert.deepEqual(searchFrames(frames, "  SERVER  config ").map((f) => f.at), [87.8]);
  assert.deepEqual(searchFrames(frames, "server").map((f) => f.at), [1, 87.8]);
  assert.deepEqual(searchFrames(frames, "kafka"), []);
  assert.deepEqual(searchFrames(frames, "").map((f) => f.at), [1, 87.8]);
});

test("highlight: marks every occurrence of every word, keeps case, escapes regex characters", () => {
  assert.deepEqual(highlight("Eureka Server, eureka", "EUREKA"), [
    { text: "Eureka", hit: true }, { text: " Server, ", hit: false }, { text: "eureka", hit: true },
  ]);
  assert.deepEqual(highlight("a (b) c", "(b)"), [{ text: "a ", hit: false }, { text: "(b)", hit: true }, { text: " c", hit: false }]);
  assert.deepEqual(highlight("plain", " "), [{ text: "plain", hit: false }]);
  assert.equal(highlight("Spring Cloud", "cloud spring").filter((p) => p.hit).length, 2);
});

test("code detection: prompts, commands, URLs, paths and code syntax, but not slide prose", () => {
  const code = [
    "$ npm install", "user@box:~$ ls -la", ">>> print(1)", "PS C:\\Users> dir", "git clone repo", "docker run -p 8080:8080 app",
    "https://spring.io/projects", "www.example.com", "http://localhost:8080/api", "localhost:8761",
    "/usr/local/bin", "~/projects/app", "./mvnw spring-boot:run", "C:\\Program Files\\Java", "src/main/App.java",
    "src/main/resources", "const x = 1", "items.map(i => i * 2)", "System.out.println(x);", "@SpringBootApplication",
    "def main():", "import React from 'react';", "from flask import Flask", "<div class=\"a\">", "spring.application.name=employee",
    "server.port: 8080", "}", "% cargo build", "3 let r1 = &s;", "fn main() {", "pub fn port(s: &str) -> PortResult {",
    ".collect();", "4 .filter(|n| n % 2 == 0)", "#[derive(IntoOwned)]", "let doubled: Vec<_> = values", "main.rs",
  ];
  const prose = [
    "Microservices Architecture using Spring boot and", "Spring Cloud Netflix", "API Gateway", "Service Registry (Eureka)",
    "Circuit breaker pattern", "Input/Output", "Examples(s)", "Note: read this", "# of users", "> 50% faster", "and/or",
    "Import your data", "Class of 2024", "Q&A", "TCP/IP", "$3700+ a month", "% of users", "1 Introduction", "Next.js and Node.js",
    "Thread A", "lock → update → unlock",
  ];
  for (const l of code) assert.ok(isCode(l), `should be code: ${l}`);
  for (const l of prose) assert.ok(!isCode(l), `should be prose: ${l}`);
});

test("blocks: consecutive lines group by kind; prose joins with a dot, code keeps its lines", () => {
  assert.deepEqual(screenBlocks("Setup\nRun this\n$ npm i\n$ npm run dev  \n\nThen open\nhttp://localhost:3000"), [
    { code: false, text: "Setup · Run this" },
    { code: true, text: "$ npm i\n$ npm run dev" },
    { code: false, text: "Then open" },
    { code: true, text: "http://localhost:3000" },
  ]);
  assert.deepEqual(screenBlocks(""), []);
});

test("copy all: each frame with text under its timestamp, empty frames left out", () => {
  assert.equal(screenText(frames),
    "[0:01]\nAPI Gateway\nSpring Cloud Netflix\nEureka Server\n\n[1:28]\nConfig Server\n$ git clone https://github.com/x/y.git");
  assert.equal(screenText([]), "");
});

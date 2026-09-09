module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "chore",
        "build",
        "ci",
        "revert",
      ],
    ],
    "subject-case": [2, "always", ["lower-case", "sentence-case"]],
    "subject-empty": [2, "never"],
    "subject-max-length": [2, "always", 72],
  },
};

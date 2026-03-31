/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],

  // Custom parser (optional but useful for strict control)
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w*)(?:\(([\w\-\s]+)\))?!?: (.+)$/,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },

  rules: {
    /*
     * =========================
     * TYPE RULES
     * =========================
     */
    'type-enum': [
      2,
      'always',
      [
        'feat', // new feature
        'fix', // bug fix
        'docs', // documentation
        'style', // formatting, missing semicolons, etc
        'refactor', // code change that neither fixes bug nor adds feature
        'perf', // performance improvement
        'test', // adding tests
        'build', // build system or dependencies
        'ci', // CI/CD changes
        'chore', // maintenance
        'revert', // revert commit
      ],
    ],

    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],

    /*
     * =========================
     * SCOPE RULES
     * =========================
     */
    'scope-empty': [1, 'never'], // warn if missing
    'scope-case': [2, 'always', 'kebab-case'],

    /*
     * =========================
     * SUBJECT RULES
     * =========================
     */
    'subject-empty': [2, 'never'],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-full-stop': [2, 'never', '.'],
    'subject-max-length': [2, 'always', 100],

    /*
     * =========================
     * HEADER RULES
     * =========================
     */
    'header-max-length': [2, 'always', 120],

    /*
     * =========================
     * BODY RULES
     * =========================
     */
    'body-leading-blank': [1, 'always'],
    'body-max-line-length': [2, 'always', 120],

    /*
     * =========================
     * FOOTER RULES
     * =========================
     */
    'footer-leading-blank': [1, 'always'],

    /*
     * =========================
     * BREAKING CHANGE
     * =========================
     */
    'breaking-change-exclamation-mark': [2, 'always'],
  },

  /*
   * =========================
   * CUSTOM PROMPT (optional for teams)
   * =========================
   */
  prompt: {
    settings: {},
    questions: {
      type: {
        description: 'Select the type of change you are committing:',
      },
      scope: {
        description: 'Denote the scope of this change (module or file name):',
      },
      subject: {
        description: 'Write a short, imperative description of the change:',
      },
      body: {
        description: 'Provide a longer description of the change:',
      },
      isBreaking: {
        description: 'Are there any breaking changes?',
      },
      footer: {
        description: 'List any issues closed by this change:',
      },
    },
  },
};

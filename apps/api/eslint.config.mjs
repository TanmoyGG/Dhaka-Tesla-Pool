import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "drizzle/", "node_modules/", "coverage/"],
  },
  ...tseslint.configs.recommended
);
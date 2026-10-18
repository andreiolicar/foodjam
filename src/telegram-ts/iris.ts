
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: fileURLToPath(new URL("./.env", import.meta.url)),
});

import {
  CatalogoFake,
  criarAgente,
  criarLlmDoAmbiente,
} from "../core/index.js";

export const iris = criarAgente({
  catalog: new CatalogoFake(),
  llm: criarLlmDoAmbiente(process.env),
  onError: (error) => console.error("[Íris]", error),
});

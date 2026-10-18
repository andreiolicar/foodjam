import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import {
  CatalogoFake,
  criarAgente,
  criarLlmDoAmbiente,
} from "../core/index.js";

dotenv.config({
  path: fileURLToPath(new URL("./.env", import.meta.url)),
});

export const iris = criarAgente({
  catalog: new CatalogoFake(),
  llm: criarLlmDoAmbiente(process.env),
  onError: (error) => console.error("[Íris]", error),
});
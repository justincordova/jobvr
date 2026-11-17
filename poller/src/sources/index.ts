import type { Registry } from "@jobvr/core";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { simplify } from "./simplify";
import { speedyapply } from "./speedyapply";

/** Source registry. Adding a source = one adapter file + one entry here. */
export const adapters: Registry = [greenhouse, lever, ashby, simplify, speedyapply];

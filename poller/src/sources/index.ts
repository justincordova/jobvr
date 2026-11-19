import type { Registry } from "@jobvr/core";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { jobright } from "./jobright";
import { lever } from "./lever";
import { simplify } from "./simplify";
import { smartrecruiters } from "./smartrecruiters";
import { speedyapply } from "./speedyapply";
import { workable } from "./workable";

/** Source registry. Adding a source = one adapter file + one entry here. */
export const adapters: Registry = [
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  simplify,
  speedyapply,
  jobright,
];

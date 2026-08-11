import {
  ModelSelection,
  ProviderDriverKind,
  type ModelSelection as ModelSelectionValue,
  type ProviderDriverKind as ProviderDriverKindValue,
} from "@t3tools/contracts";
import { Schema } from "effect";

const isModelSelection = Schema.is(ModelSelection);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSupportedPersistedProviderKind(
  providerName: string,
): providerName is ProviderDriverKindValue {
  return isProviderDriverKind(providerName);
}

export type PersistedModelSelectionInspection =
  | {
      readonly _tag: "known";
      readonly value: ModelSelectionValue;
    }
  | {
      readonly _tag: "unsupported-provider";
      readonly provider: string;
    }
  | {
      readonly _tag: "invalid";
    };

export function inspectPersistedModelSelection(value: unknown): PersistedModelSelectionInspection {
  if (isModelSelection(value)) {
    return {
      _tag: "known",
      value,
    };
  }

  if (isRecord(value) && typeof value.provider === "string") {
    if (!isSupportedPersistedProviderKind(value.provider)) {
      return {
        _tag: "unsupported-provider",
        provider: value.provider,
      };
    }
  }

  return {
    _tag: "invalid",
  };
}

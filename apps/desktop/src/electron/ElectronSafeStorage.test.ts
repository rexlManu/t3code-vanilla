import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vitest";

const { safeStorageState, setUsePlainTextEncryptionMock } = vi.hoisted(() => ({
  safeStorageState: {
    available: false,
    plainTextFallbackEnabled: false,
  },
  setUsePlainTextEncryptionMock: vi.fn((enabled: boolean) => {
    safeStorageState.plainTextFallbackEnabled = enabled;
  }),
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () =>
      safeStorageState.available || safeStorageState.plainTextFallbackEnabled,
    setUsePlainTextEncryption: setUsePlainTextEncryptionMock,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import * as ElectronSafeStorage from "./ElectronSafeStorage.ts";

describe("ElectronSafeStorage", () => {
  beforeEach(() => {
    safeStorageState.available = false;
    safeStorageState.plainTextFallbackEnabled = false;
    setUsePlainTextEncryptionMock.mockClear();
  });

  it.effect("enables Electron plaintext fallback when encryption is unavailable", () =>
    Effect.gen(function* () {
      const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

      assert.isTrue(yield* safeStorage.isEncryptionAvailable);
      assert.deepEqual(setUsePlainTextEncryptionMock.mock.calls, [[true]]);
    }).pipe(Effect.provide(ElectronSafeStorage.layer)),
  );

  it.effect("does not enable plaintext fallback when encryption is available", () =>
    Effect.gen(function* () {
      safeStorageState.available = true;
      const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

      assert.isTrue(yield* safeStorage.isEncryptionAvailable);
      assert.deepEqual(setUsePlainTextEncryptionMock.mock.calls, []);
    }).pipe(Effect.provide(ElectronSafeStorage.layer)),
  );
});

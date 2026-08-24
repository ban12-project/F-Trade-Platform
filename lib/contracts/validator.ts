import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

function describeErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function compileContract<T>(schema: object) {
  const validate = ajv.compile<T>(schema);
  return (value: unknown): T => {
    if (!validate(value)) {
      throw new Error(`Contract validation failed: ${describeErrors(validate.errors)}`);
    }
    return value;
  };
}

export function toAiSdkValidation<T>(validate: (value: unknown) => T) {
  return (value: unknown) => {
    try {
      return { success: true as const, value: validate(value) };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error : new Error("Contract validation failed"),
      };
    }
  };
}

export type ContractValidator<T> = ValidateFunction<T>;

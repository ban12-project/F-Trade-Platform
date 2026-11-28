export interface ProductIntakeModelOption {
  id: string;
  name: string;
  isDefault: boolean;
  model: string;
  discoveredModels: string[];
}

export function selectableModelNames(
  config: Pick<ProductIntakeModelOption, "model" | "discoveredModels">,
) {
  return [
    ...new Set(
      [config.model, ...config.discoveredModels].map((name) => name.trim()).filter(Boolean),
    ),
  ];
}

export function productIntakeModelChoices(configs: ProductIntakeModelOption[]) {
  const choices = configs.flatMap((config) =>
    selectableModelNames(config).map((model) => ({
      value: JSON.stringify([config.id, model]),
      configId: config.id,
      model,
      label: `${config.name} · ${model}`,
    })),
  );
  const preferred = configs.find((config) => config.isDefault) ?? configs[0];
  const defaultChoice =
    preferred &&
    choices.find(
      (choice) => choice.configId === preferred.id && choice.model === preferred.model.trim(),
    );
  return { choices, defaultChoice };
}

export type ProductIntakeModelChoices = ReturnType<typeof productIntakeModelChoices>;

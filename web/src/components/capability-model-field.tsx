import { SelectField } from "./fields";

/** 展示能力模型下拉框及对应的加载、降级或空列表提示。 */
export function CapabilityModelField({
  label,
  loading,
  message,
  modelIds,
  onChange,
  value
}: {
  label: string;
  loading: boolean;
  message?: string;
  modelIds: string[];
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="capability-model-field">
      <SelectField
        disabled={modelIds.length === 0}
        label={label}
        loading={loading}
        options={modelIds}
        value={value || undefined}
        onChange={onChange}
      />
      {message && (
        <span
          aria-live="polite"
          className={`capability-model-message${loading ? " loading" : " warning"}`}
        >
          {message}
        </span>
      )}
    </div>
  );
}

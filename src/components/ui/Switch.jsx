export default function Switch({checked, onChange, disabled}){
  return (
    <label className={`switch ${disabled?'disabled':''}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e=>onChange?.(e.target.checked)}/>
      <span className="slider"/>
    </label>
  )
}

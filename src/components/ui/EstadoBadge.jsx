import Pill from './Pill.jsx'

export default function EstadoBadge({v}){ return <Pill color={v.color}>{v.icon} {v.label}</Pill> }

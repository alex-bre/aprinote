import { RotateCcw, Settings } from 'lucide-react'
import { SHOW_TITLE_BAR } from '@/config'
import { BrandMark } from './BrandMark'
import { useVault } from '@/store/vaultStore'
import styles from './TitleBar.module.css'

export function TitleBar() {
  const vaultName = useVault((s) => s.ref?.name)
  if (!SHOW_TITLE_BAR) return null

  return (
    <div className={styles.bar}>
      <div className={styles.lights}>
        <span style={{ background: '#e0554d' }} />
        <span style={{ background: '#e3b341' }} />
        <span style={{ background: '#57b85a' }} />
      </div>
      <div className={styles.title}>
        <BrandMark size={14} />
        <span>
          aprinote — vault: <b>{vaultName}</b>
        </span>
      </div>
      <div className={styles.actions}>
        <RotateCcw size={16} />
        <Settings size={16} />
      </div>
    </div>
  )
}

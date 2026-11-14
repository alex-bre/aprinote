import { FileCode, HardDrive, PanelLeftOpen, Plus, Search } from 'lucide-react'
import { useSession } from '@/store/sessionStore'
import { useVault } from '@/store/vaultStore'
import styles from './Rail.module.css'

const RECENT = 4

export function Rail() {
  const sidebarOpen = useSession((s) => s.sidebarOpen)
  const toggleSidebar = useSession((s) => s.toggleSidebar)
  const index = useVault((s) => s.index)
  const activePath = useVault((s) => s.page?.meta.path)
  const openPage = useVault((s) => s.openPage)
  const createPage = useVault((s) => s.createPage)
  const ref = useVault((s) => s.ref)

  const recent = [...(index?.pages.values() ?? [])]
    .sort((a, b) => (a.editedAt > b.editedAt ? -1 : 1))
    .slice(0, RECENT)

  return (
    <div className={styles.rail}>
      <button
        className={`${styles.btn} ${styles.expand}`}
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Not enough width for the sidebar' : 'Show sidebar'}
      >
        <PanelLeftOpen size={16} />
      </button>
      <button className={styles.btn} title="Search pages">
        <Search size={16} />
      </button>
      {recent.map((meta) => (
        <button
          key={meta.path}
          className={`${styles.btn} ${meta.path === activePath ? styles.active : ''}`}
          onClick={() => void openPage(meta.path)}
          title={meta.title}
        >
          <FileCode size={16} />
        </button>
      ))}
      <button className={styles.btn} title="New page" onClick={() => void createPage('')}>
        <Plus size={16} />
      </button>
      <div className={`${styles.btn} ${styles.spacer}`} title={ref?.name}>
        <HardDrive size={15} />
      </div>
    </div>
  )
}

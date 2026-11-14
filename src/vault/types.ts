export interface PageMeta {
  id: string
  /** Vault-relative, e.g. `handbook/onboarding-guide.html`. */
  path: string
  title: string
  editedAt: string
}

export interface FolderNode {
  kind: 'folder'
  name: string
  path: string
  /** Total pages beneath, including pages in unexpanded subfolders. */
  count: number
  children: TreeNode[]
  /**
   * A folder holding `index.html` *is* that page — the folder row opens it and
   * the index gets no child row of its own. Absent for pure containers.
   */
  page?: PageMeta
}

export interface PageNode {
  kind: 'page'
  page: PageMeta
}

export type TreeNode = FolderNode | PageNode

export function nodeKey(node: TreeNode): string {
  return node.kind === 'folder' ? `dir:${node.path}` : `page:${node.page.path}`
}

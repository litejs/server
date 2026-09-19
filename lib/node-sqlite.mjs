
// Alone in its module so a bundle that never touches DB drops the import

export { DatabaseSync as DB } from 'node:sqlite'


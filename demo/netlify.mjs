
// Netlify Functions want the handler without the { fetch } wrapper,
// and export their routing from the file itself.

export { default } from './app.mjs'
export const config = { path: '/*', preferStatic: true }


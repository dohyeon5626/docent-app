const { execFileSync } = require('child_process')
const path = require('path')

/**
 * Ad-hoc signs the built .app (no paid Apple Developer certificate involved).
 * Without this, a downloaded-and-quarantined app on Apple Silicon shows the
 * scarier "is damaged and can't be opened" dialog instead of the milder
 * "unidentified developer" one that right-click → Open can bypass.
 */
exports.default = async function afterSign(context) {
  const { appOutDir, packager, electronPlatformName } = context
  if (electronPlatformName !== 'darwin') return

  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
  console.log(`afterSign: ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' })
}

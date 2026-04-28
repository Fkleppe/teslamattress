const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const IMAGES_DIR = path.join(__dirname, '..', 'images')

const jpgsToCompress = [
  'snuuzu-model-y-tesla-mattress.jpg',
  'tesmat-luxe-model-y-tesla-mattress.jpg',
  'tesmat-solo-model-y-tesla-mattress.jpg',
  'havnby-foam-tesla-mattress.jpg',
  'tesmat-luxe-model-3-tesla-mattress.jpg',
]

async function compressJpg(filename) {
  const filePath = path.join(IMAGES_DIR, filename)
  const beforeSize = fs.statSync(filePath).size

  const buffer = await sharp(filePath)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()

  fs.writeFileSync(filePath, buffer)
  const afterSize = buffer.length

  console.log(
    `${filename}: ${(beforeSize / 1024).toFixed(1)}KB → ${(afterSize / 1024).toFixed(1)}KB (${((1 - afterSize / beforeSize) * 100).toFixed(0)}% reduction)`
  )
}

async function convertToWebp(filename) {
  const jpgPath = path.join(IMAGES_DIR, filename)
  const webpFilename = filename.replace(/\.jpg$/, '.webp')
  const webpPath = path.join(IMAGES_DIR, webpFilename)
  const beforeSize = fs.statSync(jpgPath).size

  const buffer = await sharp(jpgPath)
    .webp({ quality: 75 })
    .toBuffer()

  fs.writeFileSync(webpPath, buffer)
  const afterSize = buffer.length

  console.log(
    `${filename} → ${webpFilename}: ${(beforeSize / 1024).toFixed(1)}KB → ${(afterSize / 1024).toFixed(1)}KB`
  )
}

async function main() {
  console.log('Compressing JPG images...\n')

  for (const file of jpgsToCompress) {
    await compressJpg(file)
  }

  console.log('\nConverting novapads-logo.jpg to WebP...\n')
  await convertToWebp('novapads-logo.jpg')

  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})

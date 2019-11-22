import Obj from '../index.js'
import LoaderManager from '../../../managers/LoaderManager.js'

// Config
import GLOBAL_CONFIG from '../../Scene/config.js'
import CONFIG from './config.js'

class Arch extends Obj {
  constructor(scene, world, material) {
    // Physics
    super(scene, world)

    // Props
    this.material = material
    this.selectable = CONFIG.SELECTABLE
    this.mass = CONFIG.MASS
    this.size = CONFIG.SIZE
    this.name = CONFIG.NAME
    this.normalMap = CONFIG.NORMAL_MAP
    this.obj = CONFIG.OBJ
  }

  init() {
    const { obj, normalMap } = LoaderManager.subjects[this.name]

    // Materials
    const defaultMaterial = new THREE.MeshToonMaterial({
      color: GLOBAL_CONFIG.COLORS.ICE,
      shininess: GLOBAL_CONFIG.SHININESS,
      normalMap
    })
    defaultMaterial.needsUpdate = true

    for (let i = 0; i < obj.children.length; i++) {
      const geometry = obj.children[i].geometry
      geometry.center()
      this.geoMats.push({
        geometry,
        material: defaultMaterial
      })
    }

    this.setShape(defaultMaterial)
  }

  createShapes(scale = 1) {
    // Compound boxes
    let s = this.size * scale
    const topBoxVector = new CANNON.Vec3(s, s * 0.25, s * 0.5)
    const topShape = new CANNON.Box(topBoxVector)

    const bottomBoxVector = new CANNON.Vec3(s * 0.33, s * 0.25, s * 0.5)
    const bottomShape = new CANNON.Box(bottomBoxVector)

    const offset1 = new CANNON.Vec3( 0, s * 0.25, 0)
    const offset2 = new CANNON.Vec3( -s * 0.66, -s * 0.25, 0)
    const offset3 = new CANNON.Vec3( s * 0.66, -s * 0.25, 0)

    this.body.addShape(topShape, offset1)
    this.body.addShape(bottomShape, offset2)
    this.body.addShape(bottomShape, offset3)
  }
}

export default Arch
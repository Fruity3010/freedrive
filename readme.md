# Zombie Survival Driving Game 🧟‍♂️🚗

A dark horror-themed 3D driving game built with Three.js where you must survive waves of zombies while navigating through a city.

## Features

### 🎮 Game Mechanics
- **Health System**: Car takes damage from zombie attacks and environmental hazards
- **Scoring**: Earn points for survival time and hitting zombies
- **Progressive Difficulty**: Zombies spawn faster and move quicker as you survive longer
- **Environmental Hazards**: Fire barrels, debris, and explosive barrels that damage your car

### 🎨 Visual Enhancements
- **Dark Horror Theme**: Nighttime atmosphere with darker colors and fog
- **Post-Processing Effects**: Vignette and film grain for cinematic feel (bloom disabled to prevent GPU texture limit issues)
- **Flickering Street Lights**: Dynamic lighting throughout the city with high emissive materials
- **Screen Shake**: Impact feedback on collisions
- **Bright Emissive Objects**: Street lights and fire hazards glow brightly without bloom

### 📱 Mobile Support
- **On-Screen Controls**: Virtual joystick for steering and gas/brake buttons
- **Touch Optimized**: Responsive controls for mobile devices
- **Adaptive UI**: HUD adjusts to screen size

### 🎯 UI Elements
- **Loading Screen**: Shows progress while assets load with gameplay tips
- **HUD**: Real-time health bar, score, survival time, and zombie count
- **Game Over Screen**: Final stats with restart option

## Controls

### Desktop
- **Arrow Up**: Accelerate
- **Arrow Down**: Brake/Reverse
- **Arrow Left/Right**: Steer

### Mobile
- **Left Joystick**: Steer left/right, forward/backward
- **Gas Button**: Accelerate (green button, top right)
- **Brake Button**: Brake/reverse (red button, bottom right)

## Setup

Download [Node.js](https://nodejs.org/en/download/).
Run these commands:

```bash
# Install dependencies (only the first time)
npm install

# Run the local server
npm run dev

# Build for production in the dist/ directory
npm run build
```

## Performance Optimizations

- Reduced shadow map size from 2048 to 1024 (4x performance gain)
- Start with 20 zombies instead of 50 (spawns more over time)
- Optimized collision detection with cooldowns
- Efficient material/geometry disposal
- Lightweight post-processing (bloom disabled by default to avoid GPU texture unit limits)

### Optional: Enable Bloom (High-End GPUs Only)

If you have a powerful GPU and want bloom effects, edit `src/index.js` line 168:

```javascript
// Change false to true
postProcessing = new PostProcessing(renderer, scene, camera, true);
```

**Warning**: This may cause shader errors on some GPUs due to texture unit limitations.

## Project Structure

```
src/
├── index.js                    # Main game logic
├── road.js                     # City generation and street lights
├── Pedestrian.js              # Zombie AI and animations
├── Hazard.js                  # Environmental hazards
├── managers/
│   ├── GameManager.js         # Game state, score, health
│   └── DifficultyManager.js   # Progressive difficulty system
├── ui/
│   ├── HUD.js                 # Health bar and score display
│   ├── LoadingScreen.js       # Asset loading screen
│   ├── MobileControls.js      # Touch controls for mobile
│   └── GameOverScreen.js      # End game screen
└── effects/
    └── PostProcessing.js      # Visual effects (bloom, vignette, grain)
```

## Technologies Used

- **Three.js**: 3D rendering engine
- **Vite**: Build tool and development server
- **GLTF Models**: 3D animated zombie and car models
- **lil-gui**: Debug GUI for development

## Future Improvements

- Add power-ups (health packs, speed boost)
- Multiple car models to choose from
- Day/night cycle
- Minimap
- Weapon system
- Leaderboard/high scores
- Sound effects and music
- Different zombie types with unique behaviors

## Credits

- "Garbage bags" by [DJMaesen](https://sketchfab.com/bumstrum) and "Low Poly | Plastic Garbage Bags" by [Den1121](https://sketchfab.com/Den1121), via Sketchfab, licensed CC-BY 4.0
- "Wheelbarrow" by Poly by Google ([Poly Pizza](https://poly.pizza/m/6XpEkgDXwkU)), "Rubbish" pile by Poly by Google ([Poly Pizza](https://poly.pizza/m/fxU6_KtzTiX)), "trash bag black" by Jens Kull ([Poly Pizza](https://poly.pizza/m/9_gWQWhmmQv)), "Bottle (Plastic)" by Zoe XR ([Poly Pizza](https://poly.pizza/m/di8BdLR1M8S)), all CC-BY 3.0
- "Trash Bags" by Quaternius ([Poly Pizza](https://poly.pizza/m/eitNk4I4R1)), public domain (CC0)
- "Toyota Hilux 97" by Muhammad Reyhan, via [Poly Pizza](https://poly.pizza/m/8-0nFArehjd), licensed CC-BY 3.0
- Pedestrian characters (Casual, Business Man, Animated Woman ×2, Worker, Farmer) by Quaternius, via [Poly Pizza](https://poly.pizza/u/Quaternius), public domain (CC0)
- "Checkers Sixty60 Bike" by [Caitlin Pillay](https://sketchfab.com/caitlin_pillay), via [Sketchfab](https://sketchfab.com/3d-models/checkers-sixty60-bike-4aabf2a85abd43f98fc4e5f2a5ae62f1), licensed CC-BY 4.0
- "Lagos Danfo Bus" by [Iam_thearchitect](https://sketchfab.com/arcoma330), via [Sketchfab](https://sketchfab.com/3d-models/lagos-danfo-bus-41b71827dcc94339b627fb79d9a7adb7), licensed CC-BY 4.0
- Water normal map from the [three.js examples](https://github.com/mrdoob/three.js), MIT

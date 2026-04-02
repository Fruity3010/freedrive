export class HUD {
    constructor() {
        this.container = null;
        this.healthBar = null;
        this.healthText = null;
        this.scoreText = null;
        this.timeText = null;
        this.createHUD();
    }

    createHUD() {
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            font-family: Arial, sans-serif;
            z-index: 1000;
        `;

        // Health bar
        const healthContainer = document.createElement('div');
        healthContainer.style.cssText = `
            background: rgba(0, 0, 0, 0.7);
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 10px;
        `;

        const healthLabel = document.createElement('div');
        healthLabel.textContent = 'HEALTH';
        healthLabel.style.cssText = `
            color: #fff;
            font-size: 14px;
            margin-bottom: 5px;
        `;

        const healthBarBg = document.createElement('div');
        healthBarBg.style.cssText = `
            width: 200px;
            height: 20px;
            background: #333;
            border-radius: 3px;
            overflow: hidden;
        `;

        this.healthBar = document.createElement('div');
        this.healthBar.style.cssText = `
            width: 100%;
            height: 100%;
            background: #4CAF50;
            transition: width 0.3s ease;
        `;

        healthBarBg.appendChild(this.healthBar);

        this.healthText = document.createElement('div');
        this.healthText.textContent = '100 / 100';
        this.healthText.style.cssText = `
            color: #fff;
            font-size: 12px;
            margin-top: 3px;
        `;

        healthContainer.appendChild(healthLabel);
        healthContainer.appendChild(healthBarBg);
        healthContainer.appendChild(this.healthText);

        // Score and time
        const statsContainer = document.createElement('div');
        statsContainer.style.cssText = `
            background: rgba(0, 0, 0, 0.7);
            padding: 10px;
            border-radius: 5px;
        `;

        this.scoreText = document.createElement('div');
        this.scoreText.textContent = 'SCORE: 0';
        this.scoreText.style.cssText = `
            color: #fff;
            font-size: 16px;
            margin-bottom: 5px;
        `;

        this.timeText = document.createElement('div');
        this.timeText.textContent = 'TIME: 0:00';
        this.timeText.style.cssText = `
            color: #fff;
            font-size: 14px;
        `;

        statsContainer.appendChild(this.scoreText);
        statsContainer.appendChild(this.timeText);

        this.container.appendChild(healthContainer);
        this.container.appendChild(statsContainer);
        document.body.appendChild(this.container);
    }

    updateHealth(health, maxHealth) {
        const percentage = (health / maxHealth) * 100;
        if (this.healthBar) {
            this.healthBar.style.width = `${percentage}%`;
            if (percentage > 50) {
                this.healthBar.style.background = '#4CAF50';
            } else if (percentage > 25) {
                this.healthBar.style.background = '#FFA500';
            } else {
                this.healthBar.style.background = '#FF0000';
            }
        }
        if (this.healthText) {
            this.healthText.textContent = `${Math.ceil(health)} / ${maxHealth}`;
        }
    }

    updateScore(score) {
        if (this.scoreText) {
            this.scoreText.textContent = `SCORE: ${Math.floor(score)}`;
        }
    }

    updateTime(time) {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        if (this.timeText) {
            this.timeText.textContent = `TIME: ${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

    show() {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }
}

export class GameManager {
    constructor() {
        this.score = 0;
        this.health = 100;
        this.maxHealth = 100;
        this.survivalTime = 0;
        this.zombiesHit = 0;
    }

    update(deltaTime) {
        this.survivalTime += deltaTime;
        this.score += deltaTime * 10; // 10 points per second
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
    }

    onZombieHit() {
        this.zombiesHit++;
        this.score += 50;
        this.takeDamage(5);
    }

    onZombieAttack() {
        this.takeDamage(2);
    }

    isGameOver() {
        return this.health <= 0;
    }
}

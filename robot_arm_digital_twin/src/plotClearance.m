function plotClearance(time, minDistances, isInCollision)
%PLOTCLEARANCE Plot minimum clearance to environment.

figure("Name", "Collision Clearance", "Color", "w");
plot(time, minDistances, "LineWidth", 1.5);
hold on;
scatter(time(isInCollision), minDistances(isInCollision), 28, "r", "filled");
yline(0, "r--", "Collision threshold");
grid on;
xlabel("Time [s]");
ylabel("Minimum distance [m]");
title("Robot Clearance to Environment");
end

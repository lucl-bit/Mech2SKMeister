function animateTrajectory(robot, qTraj, env, time, waypointTforms, waypointNames)
%ANIMATETRAJECTORY Animate robot, obstacles, and task waypoints.

figure("Name", "Robot Arm Digital Twin", "Color", "w");
ax = axes;
hold(ax, "on");
grid(ax, "on");
view(ax, 135, 25);
axis(ax, "equal");
xlim(ax, [-0.25, 0.80]);
ylim(ax, [-0.55, 0.55]);
zlim(ax, [-0.05, 0.80]);
xlabel(ax, "X [m]");
ylabel(ax, "Y [m]");
zlabel(ax, "Z [m]");

for i = 1:numel(env)
    show(env{i}, "Parent", ax);
end

for i = 1:size(waypointTforms, 3)
    p = tform2trvec(waypointTforms(:, :, i));
    plot3(ax, p(1), p(2), p(3), "ko", "MarkerSize", 5, "MarkerFaceColor", "y");
    text(ax, p(1), p(2), p(3) + 0.025, waypointNames(i), "FontSize", 8);
end

show(robot, qTraj(1, :), "Parent", ax, "PreservePlot", false, ...
    "Frames", "off", "Collisions", "on");
title(ax, "Robot Arm Digital Twin");

step = max(1, round(0.05 / max(eps, mean(diff(time)))));
for k = 1:step:size(qTraj, 1)
    show(robot, qTraj(k, :), "Parent", ax, "PreservePlot", false, ...
        "Frames", "off", "Collisions", "on");
    title(ax, sprintf("Robot Arm Digital Twin | t = %.2f s", time(k)));
    drawnow limitrate;
end
end

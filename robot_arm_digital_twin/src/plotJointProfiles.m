function plotJointProfiles(time, qTraj, qdTraj, qddTraj)
%PLOTJOINTPROFILES Plot joint position, velocity, and acceleration.

figure("Name", "Joint Profiles", "Color", "w");
tiledlayout(3, 1, "TileSpacing", "compact");

nexttile;
plot(time, qTraj, "LineWidth", 1.2);
grid on;
ylabel("q [rad]");
title("Joint Positions");

nexttile;
plot(time, qdTraj, "LineWidth", 1.2);
grid on;
ylabel("qd [rad/s]");
title("Joint Velocities");

nexttile;
plot(time, qddTraj, "LineWidth", 1.2);
grid on;
xlabel("Time [s]");
ylabel("qdd [rad/s^2]");
title("Joint Accelerations");
end

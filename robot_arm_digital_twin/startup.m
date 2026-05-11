% Add project source files to the MATLAB path.
projectRoot = fileparts(mfilename("fullpath"));
addpath(fullfile(projectRoot, "src"));

fprintf("Robot Arm Digital Twin project loaded.\n");
fprintf("Run main.m to simulate the pick-and-place task.\n");
